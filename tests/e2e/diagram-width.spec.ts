import { expect, test, type Page } from '@playwright/test';

import { pinMode, seedFakeFile, stubFsa } from './helpers';

/**
 * Mermaid diagrams size to their column (FR-5.9).
 *
 * The ceiling is mermaid's own: `width="100%"` with an inline
 * `max-width:<natural layout width>px`, so a diagram fills the column it is
 * given and is **never scaled up** past the size its own text metrics
 * produced — 16px labels stay 16px rather than ballooning on a widened page.
 *
 * The floor is ours and opt-in (`diagramScroll`, default off): below 60% of
 * natural size the labels stop being readable, so the diagram stops shrinking
 * and its container scrolls instead. Between the two — the ordinary case — it
 * simply tracks its column, and nothing scrolls either way. The preview column
 * beside the source editor never scrolls, whatever the setting says.
 *
 * Height is left alone entirely. A `max-height` cap cannot scale an SVG whose
 * width is already definite; it clips the box and lets `preserveAspectRatio`
 * shrink the drawing inside it, which is how a tall diagram once came out tiny
 * and ringed with blank.
 */

const WIDE = [
  '```mermaid',
  'flowchart LR',
  '  subgraph OFF["Checkbox OFF (default)"]',
  '    N1["N = 1<br/>Same as today"]',
  '  end',
  '  subgraph ON["Checkbox ON"]',
  '    Ncalc["N = parent slots<br/>+ sum of selected option slots"]',
  '    Ex["Example: parent 1 + scope 1 + scan 1<br/>=> N = 3 at 15 min/slot => 45 min block"]',
  '  end',
  '  OFF -.->|unchanged| Today["One slot per booking"]',
  '  ON --> Ncalc --> Ex',
  '```',
].join('\n');

const DOC = [
  '## Diagrams',
  '',
  'A paragraph, for comparison with the diagram width below.',
  '',
  WIDE,
  '',
  '```mermaid',
  'graph TD;',
  '  A-->B;',
  '```',
  '',
].join('\n');

/**
 * Disconnected subgraphs: dagre lays them side by side, so this is very wide
 * however tall the page is. At prose width it would otherwise render at ~0.3.
 */
const VERY_WIDE = [
  '## Very wide',
  '',
  '```mermaid',
  'flowchart TB',
  '  subgraph P["Patient sees fewer times"]',
  '    A["Option toggled - N changes"] --> B["Calendar re-filtered"]',
  '  end',
  '  subgraph S["Server rejects (safety net)"]',
  '    G["Wrong (start,end) length vs N"] --> H["INVALID_BOOKING_TIME"]',
  '  end',
  '  subgraph C["Two patients, overlapping spans"]',
  '    N1["Both pass FE filter"] --> R["Race on counters"]',
  '  end',
  '```',
  '',
].join('\n');

/** Tall and narrow — the axis `max-height` guards. */
const TALL = [
  '## Tall',
  '',
  '```mermaid',
  'flowchart TD',
  ...Array.from({ length: 22 }, (_, i) => `  N${i}["Node ${i}"] --> N${i + 1}`),
  '```',
  '',
].join('\n');

/** Turn the opt-in diagram scrollbars on before the app boots. */
async function enableDiagramScroll(page: Page) {
  await page.addInitScript(() => {
    const raw = window.localStorage.getItem('marknow.settings');
    const persisted = raw ? JSON.parse(raw) : { state: {} };
    persisted.state = { ...persisted.state, diagramScroll: true };
    window.localStorage.setItem('marknow.settings', JSON.stringify({ version: 0, ...persisted }));
  });
}

async function open(page: Page, mode: 'wysiwyg' | 'raw', measure?: number, body = DOC) {
  await pinMode(page, mode);
  if (measure !== undefined) {
    await page.addInitScript((ch) => {
      const raw = window.localStorage.getItem('marknow.ui');
      const persisted = raw ? JSON.parse(raw) : { state: {} };
      persisted.state = { ...persisted.state, wysiwygMeasure: ch };
      window.localStorage.setItem('marknow.ui', JSON.stringify({ version: 0, ...persisted }));
    }, measure);
  }
  await stubFsa(page);
  await seedFakeFile(page, 'diagrams.md', body);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/');
  await page.getByTestId('welcome-open').click();
}

/** Rendered size, the room it had, its natural size, and any overflow. */
async function scan(page: Page, hostSelector: string) {
  return page.evaluate((sel) => {
    return [...document.querySelectorAll<HTMLElement>(sel)].map((host) => {
      const svg = host.querySelector('svg')!;
      const css = getComputedStyle(host);
      const box = svg.getBoundingClientRect();
      const viewBox = (svg.getAttribute('viewBox') ?? '').split(/\s+/).map(Number);
      return {
        width: Math.round(box.width),
        height: Math.round(box.height),
        available: Math.round(
          host.clientWidth -
            Number.parseFloat(css.paddingLeft) -
            Number.parseFloat(css.paddingRight),
        ),
        natural: viewBox[2],
        naturalH: viewBox[3],
        scrollX: host.scrollWidth - host.clientWidth,
        scrollY: host.scrollHeight - host.clientHeight,
      };
    });
  }, hostSelector);
}

test.describe('mermaid diagram width (FR-5.9)', () => {
  test('a diagram too wide for the column scales down to fit', async ({ page }) => {
    await open(page, 'wysiwyg', 72); // the default measure, narrower than the diagram
    await expect(page.locator('.diagram-node svg')).toHaveCount(2, { timeout: 30000 });

    const [wide] = await scan(page, '.diagram-node');
    expect(wide.available).toBeLessThan(wide.natural);
    expect(wide.width).toBeCloseTo(wide.available, -1);
    // Scaled, not clipped: nothing scrolls and the aspect ratio is kept.
    expect(wide.scrollX).toBe(0);
    expect(wide.height).toBeCloseTo((wide.width * wide.naturalH) / wide.natural, -1);
  });

  test('by default even a very wide diagram shrinks to fit, with no scrollbar', async ({
    page,
  }) => {
    await open(page, 'wysiwyg', 72, VERY_WIDE);
    await expect(page.locator('.diagram-node svg')).toBeVisible({ timeout: 30000 });

    const [d] = await scan(page, '.diagram-node');
    // Small enough to be hard to read — that is the accepted trade of the
    // default, and why the setting exists.
    expect(d.available / d.natural).toBeLessThan(0.6);
    expect(d.width).toBeCloseTo(d.available, -1);
    expect(d.scrollX).toBe(0);

    // `DEBUG_DIAGRAM_SIZE` must stay off in shipped code. This diagram is
    // exactly the shape that used to trip the badge, so it is the one that
    // would catch the flag being left on.
    await expect(page.locator('.diagram-debug-badge')).toHaveCount(0);
  });

  test('a diagram too wide to stay readable scrolls instead, once enabled', async ({ page }) => {
    await enableDiagramScroll(page);
    await open(page, 'wysiwyg', 72, VERY_WIDE);
    await expect(page.locator('.diagram-node svg')).toBeVisible({ timeout: 30000 });

    const [d] = await scan(page, '.diagram-node');
    // Fitting this to the column would mean well under the 0.6 floor.
    expect(d.available / d.natural).toBeLessThan(0.6);
    expect(d.width).toBe(Math.round(d.natural * 0.6));
    // So the column scrolls, and the diagram keeps its proportions.
    expect(d.scrollX).toBeGreaterThan(0);
    expect(d.height).toBeCloseTo((d.width * d.naturalH) / d.natural, -1);

    // The overflow stays inside the diagram: a `min-width` that escapes its
    // scroll container is what once pushed the whole page off-screen.
    const blownOutBy = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(blownOutBy).toBe(0);

    // And the left edge is reachable — centring an overflowing child would put
    // it outside the scroll range.
    const leftEdge = await page.evaluate(() => {
      const host = document.querySelector<HTMLElement>('.diagram-node')!;
      const svg = host.querySelector('svg')!;
      return Math.round(svg.getBoundingClientRect().left - host.getBoundingClientRect().left);
    });
    expect(leftEdge).toBeGreaterThanOrEqual(0);
  });

  test('a diagram is never scaled up past its natural size', async ({ page }) => {
    await open(page, 'wysiwyg', 160); // far wider than either diagram
    await expect(page.locator('.diagram-node svg')).toHaveCount(2, { timeout: 30000 });

    for (const d of await scan(page, '.diagram-node')) {
      expect(d.available).toBeGreaterThan(d.natural); // room going spare
      expect(d.width).toBe(Math.round(d.natural)); // deliberately not taken
    }
  });

  test('a diagram follows the page measure back down', async ({ page }) => {
    await open(page, 'wysiwyg', 160);
    await expect(page.locator('.diagram-node svg')).toHaveCount(2, { timeout: 30000 });
    const [wide] = await scan(page, '.diagram-node');

    await page.getByTestId('page-measure-right').focus();
    for (let i = 0; i < 24; i += 1) await page.keyboard.press('ArrowLeft'); // 160 → 64ch
    const [narrowed] = await scan(page, '.diagram-node');

    expect(narrowed.available).toBeLessThan(narrowed.natural); // now the binding limit
    expect(narrowed.width).toBeLessThan(wide.width);
    expect(narrowed.width).toBeCloseTo(narrowed.available, -1);
  });

  test('a tall diagram keeps its proportions rather than being letterboxed', async ({ page }) => {
    await open(page, 'wysiwyg', 72, TALL);
    await expect(page.locator('.diagram-node svg')).toBeVisible({ timeout: 30000 });

    const [tall] = await scan(page, '.diagram-node');
    expect(tall.naturalH).toBeGreaterThan(1000); // genuinely tall

    // A `max-height` cap looks like the right guard but cannot scale an SVG
    // whose width is already definite: it clips the box, and
    // `preserveAspectRatio` then shrinks the drawing inside it and pads the
    // sides — a tall diagram came out small and ringed with blank. The box
    // must keep the diagram's own aspect ratio.
    expect(tall.width / tall.height).toBeCloseTo(tall.natural / tall.naturalH, 2);
    expect(tall.height).toBe(Math.round(tall.naturalH));
    expect(tall.scrollY).toBe(0);
    expect(tall.scrollX).toBe(0);
  });

  test('the preview shares the same sizing', async ({ page }) => {
    await open(page, 'raw');
    await expect(page.locator('.md-doc .mermaid-diagram svg')).toHaveCount(2, { timeout: 30000 });

    const [wide, tiny] = await scan(page, '.md-doc .mermaid-diagram');
    // Wide one scales to the 72ch column…
    expect(wide.available).toBeLessThan(wide.natural);
    expect(wide.width).toBeCloseTo(wide.available, -1);
    // …the small one keeps its natural size rather than stretching.
    expect(tiny.width).toBe(Math.round(tiny.natural));

    const docOverflow = await page.evaluate(() => {
      const doc = document.querySelector('.md-doc') as HTMLElement;
      return doc.scrollWidth - doc.clientWidth;
    });
    expect(docOverflow).toBeLessThanOrEqual(1);
  });

  test('the preview column never scrolls a diagram, even with the setting on', async ({ page }) => {
    await enableDiagramScroll(page);
    await open(page, 'raw', undefined, VERY_WIDE);
    await expect(page.locator('.md-doc .mermaid-diagram svg')).toBeVisible({ timeout: 30000 });

    const [d] = await scan(page, '.md-doc .mermaid-diagram');
    // Same document and setting that scrolls in the editor: here it scales.
    expect(d.available / d.natural).toBeLessThan(0.6);
    expect(d.width).toBeCloseTo(d.available, -1);
    expect(d.scrollX).toBe(0);
  });

  test('export renders diagrams attached, so the canvas repair can measure', async ({ page }) => {
    await page.goto('/');
    const svg = await page.evaluate(async (url) => {
      const mod = (await import(/* @vite-ignore */ url)) as {
        renderDocumentHtml: (body: string) => Promise<string>;
      };
      const html = await mod.renderDocumentHtml('```mermaid\nflowchart LR\n  A-->B-->C\n```\n');
      return /<svg[^>]*>/.exec(html)?.[0] ?? '';
    }, '/src/features/export/render-doc.ts');

    // `getBBox()` only reports inside the live document, so a detached render
    // silently skipped the repair and exported whatever mermaid declared —
    // including, for the diagram that prompted this, a canvas that cropped it.
    // The stamp is only written once the measurement succeeds.
    expect(svg).toContain('data-refit');
    expect(svg).toContain('viewBox');
  });

  test('a long code line does not push the page off-screen', async ({ page }) => {
    // The editor pane is a row flex item; without `min-w-0` its automatic
    // minimum is the min-content width of the widest block, which stretches the
    // pane past the window and slides the page out of view (AppShell).
    const long = ['## Head', '', '```js', `const x = "${'y'.repeat(600)}";`, '```', ''].join('\n');
    await open(page, 'wysiwyg', 72, long);
    await expect(page.locator('.milkdown-code-block')).toBeVisible({ timeout: 30000 });

    const blownOutBy = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(blownOutBy).toBe(0);
  });
});
