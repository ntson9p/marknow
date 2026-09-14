import { expect, test, type Page } from '@playwright/test';

import { pinMode, seedFakeFile, stubFsa } from './helpers';

/**
 * List type buttons in the WYSIWYG pane (FR-5.2).
 *
 * Each of the three is a setter with a toggle-off: it puts the selected items
 * into the kind asked for, whatever they are now, and clicking the kind they
 * already are lifts them out of the list. The source pane has always behaved
 * this way (`toggleLinePrefix`); the WYSIWYG pane used to be wrap-only, so a
 * second press — and every conversion between kinds — silently did nothing.
 *
 * Asserted through the source pane in dual mode: the markdown is the contract,
 * and a marker drawn from the wrong item attr shows up there and nowhere else.
 */

const raw = (page: Page) => page.locator('.cm-content');
const wys = (page: Page) => page.locator('.ProseMirror');
// Scoped: the bubble menu would duplicate button names when text is selected.
const toolbar = (page: Page) => page.getByTestId('wysiwyg-toolbar');

const bullet = (page: Page) => toolbar(page).getByRole('button', { name: /^Bullet list/ });
const numbered = (page: Page) => toolbar(page).getByRole('button', { name: /^Numbered list/ });
const task = (page: Page) => toolbar(page).getByRole('button', { name: /^Task list/ });

async function open(page: Page, content: string) {
  await stubFsa(page);
  await seedFakeFile(page, 'lists.md', content);
  await pinMode(page, 'dual');
  await page.goto('/');
  await page.getByTestId('welcome-open').click();
  await expect(raw(page)).toBeVisible({ timeout: 30000 });
  await expect(wys(page)).toBeVisible({ timeout: 30000 });
}

/**
 * The document as the source pane holds it, read a line element at a time.
 * Not `innerText`, which invents a newline per rendered line — precisely the
 * difference between a tight list and a loose one. (Fine at these sizes;
 * CodeMirror only renders the lines on screen.)
 */
function sourceText(page: Page): Promise<string> {
  return page.evaluate(() =>
    [...document.querySelectorAll('.cm-content .cm-line')]
      .map((line) => line.textContent ?? '')
      .join('\n')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+$/, ''),
  );
}

/**
 * Wait for the markdown to become exactly this. Polled rather than read once:
 * the WYSIWYG→store→source sync is debounced, so a single read lands on the
 * previous state often enough to be useless — and, under parallel load, so
 * does any fixed delay.
 */
async function expectMarkdown(page: Page, expected: string) {
  await expect.poll(() => sourceText(page), { message: 'source pane markdown' }).toBe(expected);
}

/** The rich pane's paragraph holding exactly this text. */
const para = (page: Page, text: string) =>
  wys(page)
    .locator('p')
    .filter({ hasText: new RegExp(`^${text}$`) })
    .first();

/**
 * Select from the start of one block to the end of another, the way a user
 * drags. Not Ctrl+A: that yields an AllSelection, which has no block range to
 * work from — every selection-shaped feature here ignores it.
 */
async function selectBlocks(page: Page, first: string, last: string) {
  await para(page, first).click();
  await page.keyboard.press('Home');
  await para(page, last).click({ modifiers: ['Shift'] });
  await page.keyboard.press('Shift+End');
}

test.describe('list kinds in the WYSIWYG pane (FR-5.2)', () => {
  test('a paragraph becomes a bullet list, and comes back out', async ({ page }) => {
    await open(page, 'alpha\n');
    await para(page, 'alpha').click();

    await bullet(page).click();
    await expectMarkdown(page, '- alpha');

    // The regression: a second press used to be a silent no-op, because
    // `wrapIn` can only add a wrapper and never remove one.
    await bullet(page).click();
    await expectMarkdown(page, 'alpha');
  });

  test('every kind converts to every other kind', async ({ page }) => {
    await open(page, '- alpha\n- beta\n');
    await selectBlocks(page, 'alpha', 'beta');

    await numbered(page).click();
    await expectMarkdown(page, '1. alpha\n2. beta');

    await task(page).click();
    await expectMarkdown(page, '- [ ] alpha\n- [ ] beta');

    // Task used to be the only way out of a task list: Bullet saw a node that
    // already was a bullet_list and had nothing to wrap.
    await bullet(page).click();
    await expectMarkdown(page, '- alpha\n- beta');

    await task(page).click();
    await expectMarkdown(page, '- [ ] alpha\n- [ ] beta');

    await numbered(page).click();
    await expectMarkdown(page, '1. alpha\n2. beta');
  });

  test('clicking the kind a list already is lifts it back to paragraphs', async ({ page }) => {
    await open(page, '- [ ] alpha\n- [ ] beta\n');
    await selectBlocks(page, 'alpha', 'beta');

    await task(page).click();
    await expectMarkdown(page, 'alpha\n\nbeta');
  });

  test('each selected paragraph becomes its own item', async ({ page }) => {
    await open(page, 'alpha\n\nbeta\n\ngamma\n');
    await selectBlocks(page, 'alpha', 'gamma');

    // `wrapIn` used to produce ONE item holding all three paragraphs, since
    // `list_item` content is `paragraph block*` and that is a legal wrapping.
    await numbered(page).click();
    await expectMarkdown(page, '1. alpha\n2. beta\n3. gamma');
  });

  test('converting part of a list splits it, like the source pane', async ({ page }) => {
    await open(page, '- alpha\n- beta\n- gamma\n');
    // Caret in the middle item only — the scope is what the selection covers.
    await para(page, 'beta').click();

    await numbered(page).click();
    await expectMarkdown(page, '- alpha\n\n1. beta\n\n- gamma');
  });

  test('a nested list keeps its own kind when the outer one changes', async ({ page }) => {
    await open(page, '- alpha\n  - nested\n- beta\n');
    await selectBlocks(page, 'alpha', 'beta');

    await numbered(page).click();
    await expectMarkdown(page, '1. alpha\n   - nested\n2. beta');
  });

  test('the keyboard shortcuts are setters too (FR-5.3)', async ({ page }) => {
    await open(page, 'alpha\n');
    await para(page, 'alpha').click();

    await page.keyboard.press('ControlOrMeta+Shift+8');
    await expectMarkdown(page, '- alpha');

    // Same bug, same fix: the shortcuts call the same command the toolbar does.
    await page.keyboard.press('ControlOrMeta+Shift+7');
    await expectMarkdown(page, '1. alpha');

    await page.keyboard.press('ControlOrMeta+Shift+9');
    await expectMarkdown(page, '- [ ] alpha');

    await page.keyboard.press('ControlOrMeta+Shift+9');
    await expectMarkdown(page, 'alpha');
  });

  // Select-all resolves at the document root, so it carries no block range at
  // all — the buttons used to look dead after Ctrl+A. The command narrows the
  // selection to the text it covers before doing anything.
  test.describe('select-all', () => {
    test('converts a whole-document list, and lifts it back out', async ({ page }) => {
      await open(page, '- alpha\n- beta\n');
      await para(page, 'alpha').click();
      await page.keyboard.press('ControlOrMeta+a');

      await numbered(page).click();
      await expectMarkdown(page, '1. alpha\n2. beta');

      await page.keyboard.press('ControlOrMeta+a');
      await numbered(page).click();
      await expectMarkdown(page, 'alpha\n\nbeta');
    });

    test('is still one undo step', async ({ page }) => {
      // Narrowing dispatches a transaction of its own. It carries no steps, so
      // history ignores it — one press stays one Ctrl+Z.
      await open(page, '- alpha\n- beta\n');
      await para(page, 'alpha').click();
      await page.keyboard.press('ControlOrMeta+a');

      await numbered(page).click();
      await expectMarkdown(page, '1. alpha\n2. beta');

      await wys(page).click();
      await page.keyboard.press('ControlOrMeta+z');
      await expectMarkdown(page, '- alpha\n- beta');
    });

    test('wraps a document of loose paragraphs', async ({ page }) => {
      await open(page, 'alpha\n\nbeta\n');
      await para(page, 'alpha').click();
      await page.keyboard.press('ControlOrMeta+a');

      await bullet(page).click();
      await expectMarkdown(page, '- alpha\n- beta');
    });

    test('leaves a document it cannot convert exactly as it was', async ({ page }) => {
      // A heading cannot be a list item's first child (`paragraph block*`), so
      // there is no legal wrapping for this mixture. Declining has to leave
      // every byte alone — a half-applied structural edit is the one outcome
      // worse than doing nothing.
      const mixed = '# Title\n\nalpha\n\n- one\n- two\n';
      await open(page, mixed);
      await para(page, 'alpha').click();
      await page.keyboard.press('ControlOrMeta+a');

      await numbered(page).click();
      await expectMarkdown(page, '# Title\n\nalpha\n\n- one\n- two');
    });
  });

  test('a tight list stays tight through a conversion (D13)', async ({ page }) => {
    // `syncListOrderPlugin` retypes a bullet list whose items claim to be
    // ordered, and writes a STRING `spread` doing it — which serializes every
    // item loose. Moving node type and item attrs together avoids that path,
    // and this is the assertion that would catch it: no blank line between
    // the items.
    await open(page, '- alpha\n- beta\n');
    await selectBlocks(page, 'alpha', 'beta');

    await numbered(page).click();
    await expectMarkdown(page, '1. alpha\n2. beta');
  });
});
