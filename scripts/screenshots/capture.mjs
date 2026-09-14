/**
 * Capture the README screenshots from the running app.
 *
 * Deterministic by construction: a fixed demo document is seeded through the
 * same File System Access stub the e2e suite uses, animations and caret blink
 * are frozen, and every shot waits for its async renderers (mermaid, KaTeX,
 * web fonts) before the shutter.
 *
 *   npm run dev -- --port 4173 --strictPort   # in another terminal
 *   node scripts/screenshots/capture.mjs [name ...]
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../../docs/screenshots');
const BASE = process.env.BASE_URL ?? 'http://localhost:4173';
const DOC = readFileSync(resolve(HERE, 'demo-doc.md'), 'utf8');
const FILE = 'aurora-launch-plan.md';

mkdirSync(OUT, { recursive: true });

/** Freeze everything that could differ between two runs. */
const STEADY = `
  *, *::before, *::after {
    transition-duration: 0s !important;
    animation-duration: 0s !important;
    animation-delay: 0s !important;
  }
  .cm-cursorLayer, .cm-cursor, .cm-dropCursor { visibility: hidden !important; }
  .ProseMirror-gapcursor { display: none !important; }
`;

/** Seed theme, persisted UI + settings state, and the fake disk before boot. */
async function seed(page, theme, ui, settings = {}) {
  await page.addInitScript(
    ([t, uiState, prefs, name, text]) => {
      localStorage.setItem('marknow.theme', t);
      localStorage.setItem('marknow.ui', JSON.stringify({ version: 0, state: uiState }));
      // Only when a shot asks for a non-default preference — an empty object
      // would still pin every default, and defaults are what most shots show.
      if (Object.keys(prefs).length) {
        localStorage.setItem('marknow.settings', JSON.stringify({ version: 0, state: prefs }));
      }
      const files = { [name]: text };
      const handle = (n) => ({
        kind: 'file',
        name: n,
        queryPermission: async () => 'granted',
        requestPermission: async () => 'granted',
        isSameEntry: async () => false,
        getFile: async () => ({ name: n, text: async () => files[n] ?? '' }),
        createWritable: async () => ({
          write: async (v) => {
            files[n] = v;
          },
          close: async () => {},
        }),
      });
      window.__fsaFiles = files;
      window.showOpenFilePicker = async () => [handle(name)];
      window.showSaveFilePicker = async (o) => handle(o?.suggestedName ?? 'untitled.md');
    },
    [theme, ui, settings, FILE, DOC],
  );
}

async function newPage(browser, { theme = 'light', viewport, mobile = false } = {}) {
  const context = await browser.newContext({
    viewport: viewport ?? { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    reducedMotion: 'reduce',
    colorScheme: theme,
    isMobile: mobile,
    hasTouch: mobile,
  });
  return { context, page: await context.newPage() };
}

/** Boot the app with the demo document already open. */
async function openDoc(
  browser,
  { theme = 'light', ui = {}, settings = {}, viewport, mobile } = {},
) {
  const { context, page } = await newPage(browser, { theme, viewport, mobile });
  await seed(page, theme, { mode: 'wysiwyg', ...ui }, settings);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: STEADY });
  await page.getByTestId('welcome-open').click();
  await page.getByTestId('doc-title').filter({ hasText: FILE }).waitFor();
  await page.locator('.ProseMirror, .cm-content').first().waitFor();
  return { context, page };
}

/** Scroll a heading to the top of its pane, then let lazy renderers catch up. */
async function scrollTo(page, heading) {
  await page.evaluate((text) => {
    for (const el of document.querySelectorAll('h1, h2, h3')) {
      if (el.textContent?.trim() === text) {
        el.scrollIntoView({ block: 'start', behavior: 'instant' });
      }
    }
  }, heading);
  await page.waitForTimeout(700);
}

/** Wait for mermaid + KaTeX + fonts; both renderers are lazy chunks. */
async function settle(page, { mermaid = true, math = true } = {}) {
  if (mermaid) {
    await page.locator('.diagram-node svg, .mermaid svg').first().waitFor({ timeout: 30_000 });
  }
  if (math) await page.locator('.katex').first().waitFor({ timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
}

async function shoot(page, name) {
  await page.screenshot({ path: resolve(OUT, `${name}.png`) });
  console.log(`  ok ${name}.png`);
}

async function hero(browser, theme) {
  const { context, page } = await openDoc(browser, {
    theme,
    ui: { mode: 'dual', outlineVisible: true },
  });
  await settle(page);
  await scrollTo(page, 'Rollout sequence');
  await shoot(page, `hero-${theme}`);
  await context.close();
}

/** Replace a whole source line; yields a legible one-for-one diff chunk. */
async function rewriteLine(page, match, replacement) {
  await page.locator('.cm-line').filter({ hasText: match }).first().click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await page.keyboard.type(replacement);
}

/** Append to the end of a source line. */
async function appendToLine(page, match, addition) {
  await page.locator('.cm-line').filter({ hasText: match }).first().click();
  await page.keyboard.press('End');
  await page.keyboard.type(addition);
}

/**
 * Three small, honest edits so Review Changes has a realistic diff: one added
 * line, one rewritten table row, one extended sentence. The new task item is
 * typed without its `- [ ] ` marker because raw mode continues the list itself.
 */
async function editDocument(page) {
  await appendToLine(page, 'Public API docs', '\nBilling integration');
  await rewriteLine(page, '| Dashboard', '| Dashboard  | Wei   | High       |');
  await appendToLine(page, 'Beta is feature-complete', ' The ship date is locked.');
  await page.waitForTimeout(600);
}

/** Screenshot only as much height as the diff actually fills. */
async function shootDiff(page, name) {
  const height = await page.evaluate(() => {
    const panes = [...document.querySelectorAll('[data-testid="diff-editor"] .cm-content')];
    const content = Math.max(...panes.map((el) => el.getBoundingClientRect().bottom));
    return Math.ceil(content + 24);
  });
  const width = page.viewportSize().width;
  await page.screenshot({
    path: resolve(OUT, `${name}.png`),
    clip: { x: 0, y: 0, width, height: Math.min(height, page.viewportSize().height) },
  });
  console.log(`  ok ${name}.png`);
}

// --- Shots -------------------------------------------------------------------
const SHOTS = {
  /**
   * The empty state: what a first-time visitor actually lands on. Shot at a
   * shorter viewport because the start page centres its content — a 900px-tall
   * frame would be mostly empty background.
   */
  async welcome(browser) {
    const { context, page } = await newPage(browser, { viewport: { width: 1440, height: 700 } });
    await seed(page, 'light', { mode: 'wysiwyg' });
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: STEADY });
    await page.getByTestId('welcome-new').waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    await shoot(page, 'welcome');
    await context.close();
  },

  /** Hero: dual mode with the outline open, parked on the rendered diagram. */
  'hero-light': (browser) => hero(browser, 'light'),
  'hero-dark': (browser) => hero(browser, 'dark'),

  /** Rich-text editing: callout, task list and table as formatted blocks. */
  async wysiwyg(browser) {
    const { context, page } = await openDoc(browser, { ui: { mode: 'wysiwyg' } });
    await settle(page);
    await scrollTo(page, 'Aurora — Launch Plan');
    await shoot(page, 'wysiwyg');
    await context.close();
  },

  /**
   * The slash menu -- the main discovery path for block insertion. Anchored to
   * a new block under the opening paragraph so the menu has clear space below
   * it rather than colliding with the end of the document.
   */
  async 'slash-menu'(browser) {
    const { context, page } = await openDoc(browser, { ui: { mode: 'wysiwyg' } });
    await settle(page);
    await scrollTo(page, 'Aurora — Launch Plan');
    const intro = page
      .locator('.wysiwyg-root .ProseMirror p')
      .filter({ hasText: 'single source of truth' })
      .first();
    await intro.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/');
    await page.locator('.milkdown-slash-menu').waitFor({ timeout: 10_000 });
    await page.waitForTimeout(600);
    await shoot(page, 'slash-menu');
    await context.close();
  },

  /** Selection bubble menu: formatting without leaving the text. */
  async 'bubble-menu'(browser) {
    // Opt-in (FR-13) — the shot is of the feature, so it turns it on.
    const { context, page } = await openDoc(browser, {
      ui: { mode: 'wysiwyg' },
      settings: { bubbleMenu: true },
    });
    await settle(page);
    await scrollTo(page, 'Rollback');
    const phrase = 'five consecutive minutes';
    await page.evaluate((needle) => {
      const paras = [...document.querySelectorAll('.wysiwyg-root .ProseMirror p')];
      const p = paras.find((el) => el.textContent?.includes(needle));
      if (!p) return;
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const i = node.textContent.indexOf(needle);
        if (i === -1) continue;
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + needle.length);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        break;
      }
      document
        .querySelector('.wysiwyg-root .ProseMirror')
        .dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    }, phrase);
    await page.locator('.milkdown-bubble-menu').waitFor({ timeout: 10_000 });
    await page.waitForTimeout(500);
    await shoot(page, 'bubble-menu');
    await context.close();
  },

  /** Raw source with the scroll-synced preview, parked on the KaTeX block. */
  async 'raw-preview'(browser) {
    const { context, page } = await openDoc(browser, {
      ui: { mode: 'raw', rawPreviewVisible: true },
    });
    await settle(page, { mermaid: false });
    await scrollTo(page, 'Capacity model');
    await shoot(page, 'raw-preview');
    await context.close();
  },

  /** Review changes: the diff of unsaved edits against the file on disk. */
  async 'review-changes'(browser) {
    const { context, page } = await openDoc(browser, { ui: { mode: 'raw' } });
    await settle(page, { mermaid: false, math: false });
    await editDocument(page);
    await page.keyboard.press('Control+Shift+KeyD');
    await page.getByTestId('diff-overlay').waitFor({ timeout: 10_000 });
    await page.getByTestId('diff-editor').waitFor();
    await page.waitForTimeout(800);
    await shootDiff(page, 'review-changes');
    await context.close();
  },

  /** Full-screen mermaid editor: source on the left, live preview on the right. */
  async 'diagram-editor'(browser) {
    const { context, page } = await openDoc(browser, { ui: { mode: 'wysiwyg' } });
    await settle(page, { math: false });
    await page.locator('.diagram-node').first().click();
    await page.getByTestId('diagram-editor').waitFor({ timeout: 10_000 });
    await page.getByTestId('diagram-preview').locator('svg').waitFor({ timeout: 30_000 });
    await page.waitForTimeout(800);
    await shoot(page, 'diagram-editor');
    await context.close();
  },

  /** Phone layout: single pane, same document, same rendering. */
  async mobile(browser) {
    const { context, page } = await openDoc(browser, {
      ui: { mode: 'wysiwyg' },
      viewport: { width: 390, height: 844 },
      mobile: true,
    });
    await settle(page, { math: false });
    await scrollTo(page, 'Rollout sequence');
    await shoot(page, 'mobile');
    await context.close();
  },
};

const wanted = process.argv.slice(2);
const names = wanted.length ? wanted : Object.keys(SHOTS);
const browser = await chromium.launch();
try {
  for (const name of names) {
    if (!SHOTS[name]) throw new Error(`Unknown shot: ${name}`);
    console.log(`-> ${name}`);
    await SHOTS[name](browser);
  }
} finally {
  await browser.close();
}
