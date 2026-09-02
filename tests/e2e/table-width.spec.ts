import { expect, test, type Page } from '@playwright/test';

import { pinMode, seedFakeFile, stubFsa } from './helpers';

/**
 * Tables fill their column and scroll on their own when too wide (FR-4.4:
 * preview, WYSIWYG and export share one table presentation).
 *
 * `display: block` on a table — the classic horizontal-scroll trick — leaves
 * the rows in an anonymous shrink-to-fit box, so `width: 100%` does nothing
 * and a table ignores the width of the column it sits in.
 */

const DOC = [
  '## Glossary',
  '',
  'A paragraph, for comparison with the table width below.',
  '',
  '| Term | Meaning |',
  '| --- | --- |',
  '| slot | One bookable time cell |',
  '| frame | A settings document |',
  '',
  '| A | B | C | D | E | F | G | H | I | J | K | L |',
  '| - | - | - | - | - | - | - | - | - | - | - | - |',
  '| wwwwwwwwww | wwwwwwwwww | wwwwwwwwww | wwwwwwwwww | wwwwwwwwww | wwwwwwwwww | wwwwwwwwww | wwwwwwwwww | wwwwwwwwww | wwwwwwwwww | wwwwwwwwww | wwwwwwwwww |',
  '',
].join('\n');

async function open(page: Page, mode: 'wysiwyg' | 'raw', measure?: number) {
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
  await seedFakeFile(page, 'tables.md', DOC);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/');
  await page.getByTestId('welcome-open').click();
}

/** Width of the visible table — the row box, not the element box. */
async function rowWidth(page: Page, nth: number) {
  return page.evaluate(
    (i) => Math.round(document.querySelectorAll('tr')[i]!.getBoundingClientRect().width),
    nth,
  );
}

test.describe('table width (FR-4.4)', () => {
  test('a WYSIWYG table fills the page and follows the page measure', async ({ page }) => {
    await open(page, 'wysiwyg', 120);
    await expect(page.locator('.ProseMirror table.mk-table-grid').first()).toBeVisible({
      timeout: 30000,
    });

    const paragraph = await page.evaluate(() =>
      Math.round(document.querySelector('.ProseMirror p')!.getBoundingClientRect().width),
    );
    const wide = await rowWidth(page, 0);
    expect(wide).toBeCloseTo(paragraph, -1); // fills the widened page

    // Narrow the measure: the table follows it down again.
    await page.getByTestId('page-measure-right').focus();
    for (let i = 0; i < 8; i += 1) await page.keyboard.press('ArrowLeft'); // 120 → 88ch
    const narrowedParagraph = await page.evaluate(() =>
      Math.round(document.querySelector('.ProseMirror p')!.getBoundingClientRect().width),
    );
    expect(narrowedParagraph).toBeLessThan(paragraph);
    expect(await rowWidth(page, 0)).toBeCloseTo(narrowedParagraph, -1);
  });

  test('a preview table fills the column; an over-wide one scrolls itself', async ({ page }) => {
    await open(page, 'raw');
    await expect(page.locator('.md-doc table').first()).toBeVisible({ timeout: 30000 });

    const geometry = await page.evaluate(() => {
      const doc = document.querySelector('.md-doc') as HTMLElement;
      const wrappers = [...document.querySelectorAll<HTMLElement>('.md-table-scroll')];
      const rows = [...document.querySelectorAll('tr')];
      return {
        wrappers: wrappers.length,
        docWidth: Math.round(doc.getBoundingClientRect().width),
        // Table 1 is narrow: it should stretch to the wrapper width.
        narrowRow: Math.round(rows[0]!.getBoundingClientRect().width),
        narrowWrapper: Math.round(wrappers[0]!.getBoundingClientRect().width),
        // Table 2 is over-wide: it scrolls inside its own wrapper…
        wideScrolls: wrappers[1]!.scrollWidth > wrappers[1]!.clientWidth,
        wideWrapperWidth: Math.round(wrappers[1]!.getBoundingClientRect().width),
        // …and must not push the document sideways.
        docScrollsHorizontally: doc.scrollWidth > doc.clientWidth,
      };
    });

    expect(geometry.wrappers).toBe(2);
    expect(geometry.narrowRow).toBeCloseTo(geometry.narrowWrapper, -1);
    expect(geometry.wideScrolls).toBe(true);
    expect(geometry.wideWrapperWidth).toBeLessThanOrEqual(geometry.docWidth);
    expect(geometry.docScrollsHorizontally).toBe(false);
  });
  test('the chrome never makes a table that fits scroll', async ({ page }) => {
    await open(page, 'wysiwyg', 140);
    await expect(page.locator('.ProseMirror table.mk-table-grid').first()).toBeVisible({
      timeout: 30000,
    });

    // The reported bug, in the position that triggered it: an insert
    // affordance on the *last* column's right edge. The kit drew it inside the
    // table's scroll container, so ~14px of button landed past the content
    // edge and a table that fitted grew a horizontal scrollbar.
    const first = page.locator('.mk-table').first();
    await first.locator('th').last().hover();
    const addColumn = first.locator('.mk-table-pill-col .mk-pill-add');
    await expect(addColumn).toBeVisible();
    await addColumn.hover();
    await expect(first.locator('.mk-table-indicator')).toBeVisible();

    // Then resize well below the width the chrome was measured at — the case
    // that used to leave stale geometry overflowing behind hidden handles.
    await page.getByTestId('page-measure-right').focus();
    for (let i = 0; i < 12; i += 1) await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(150);

    const overflow = await page.evaluate(() => {
      // Table 2 in the fixture is deliberately over-wide and *should* scroll.
      const scroller = document.querySelector<HTMLElement>('.mk-table-scroll')!;
      return {
        horizontal: scroller.scrollWidth - scroller.clientWidth,
        vertical: scroller.scrollHeight - scroller.clientHeight,
      };
    });
    expect(overflow.horizontal).toBe(0);
    expect(overflow.vertical).toBe(0);
  });

  test('the insertion preview marks the boundary the + will insert at', async ({ page }) => {
    await open(page, 'wysiwyg', 100);
    const first = page.locator('.mk-table').first();
    await expect(first.locator('table.mk-table-grid')).toBeVisible({ timeout: 30000 });

    // Hovering a first-column cell raises that row's pill; its `+` means
    // "insert below", so the preview belongs on the row's bottom edge.
    const row = first.locator('tbody tr').nth(1);
    await row.locator('td').first().hover();
    const addRow = first.locator('.mk-table-pill-row .mk-pill-add');
    await expect(addRow).toBeVisible();
    await addRow.hover();

    const placement = await page.evaluate(() => {
      const table = document.querySelector('.mk-table')!;
      const indicator = table.querySelector<HTMLElement>('.mk-table-indicator')!;
      const rows = table.querySelectorAll('tbody tr');
      return {
        offBy: Math.round(
          indicator.getBoundingClientRect().top - rows[1]!.getBoundingClientRect().bottom,
        ),
      };
    });
    expect(Math.abs(placement.offBy)).toBeLessThanOrEqual(2);

    // …and the affordance still works.
    const before = await first.locator('tbody tr').count();
    await addRow.click();
    await expect(first.locator('tbody tr')).toHaveCount(before + 1);
  });

  test('right-click in a cell opens the table menu', async ({ page }) => {
    await open(page, 'wysiwyg', 100);
    const first = page.locator('.mk-table').first();
    await expect(first.locator('table.mk-table-grid')).toBeVisible({ timeout: 30000 });

    // The pills follow the header row and the first column; every other cell
    // reaches the same operations from where the pointer already is.
    await first.locator('tbody tr').nth(1).locator('td').nth(1).click({ button: 'right' });
    const menu = page.locator('.mk-table-menu');
    await expect(menu).toBeVisible();

    const before = await first.locator('tbody tr').count();
    await menu.getByRole('menuitem', { name: 'Insert 1 row above' }).click();
    await expect(menu).toBeHidden();
    await expect(first.locator('tbody tr')).toHaveCount(before + 1);
  });

  test('scroll-sync anchors survive the wrapper', async ({ page }) => {
    await open(page, 'raw');
    await expect(page.locator('.md-doc table').first()).toBeVisible({ timeout: 30000 });
    // The stamp stays on the table; the wrapper must not duplicate the line.
    await expect(page.locator('.md-doc table[data-sourcepos]')).toHaveCount(2);
    await expect(page.locator('.md-table-scroll[data-sourcepos]')).toHaveCount(0);
  });
});
