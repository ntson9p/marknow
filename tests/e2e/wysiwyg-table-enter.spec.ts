import { expect, test, type Locator, type Page } from '@playwright/test';

import { getFakeDisk, insertTable, seedFakeFile, stubFsa } from './helpers';

/**
 * Enter, Shift+Enter and Tab inside a table (FR-5.7). Live-typing behaviour,
 * which is why the seeded-markdown specs never covered it.
 *
 * Enter starts a new line in the cell, as Docs and Word do. The line break is
 * a `<br>` because a pipe-table row is one line of source — see
 * `nodes/table-break.ts`. Moving between cells is Tab and the arrow keys;
 * leaving the table is Mod-Enter.
 */

const editor = (page: Page) => page.locator('.ProseMirror');
// `.mk-table-grid` is the NodeView's grid; its tbody holds the rows.
const grid = (page: Page) => editor(page).locator('table.mk-table-grid');
const cells = (page: Page) => grid(page).locator('th, td');

async function docWithTable(page: Page) {
  await page.goto('/');
  await page.getByTestId('welcome-new').click();
  // Generous timeout: the WYSIWYG engine is a lazy chunk that the dev server
  // cold-compiles on first navigation under parallel load.
  await expect(editor(page)).toBeVisible({ timeout: 30000 });
  await editor(page).click();
  await insertTable(page);
  await expect(cells(page)).toHaveCount(9);
}

async function openFile(page: Page, name: string, body: string) {
  await stubFsa(page);
  await seedFakeFile(page, name, body);
  await page.addInitScript((n) => {
    (window as unknown as Record<string, unknown>).__openFileName = n;
  }, name);
  await page.goto('/');
  await page.getByTestId('welcome-open').click();
  await expect(grid(page)).toBeVisible({ timeout: 30000 });
}

async function save(page: Page, name: string) {
  await page.waitForTimeout(600); // push debounce
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.getByTestId('status-save')).toContainText('Saved');
  return (await getFakeDisk(page))[name];
}

/**
 * Click a cell, then let the view catch up before the next keystroke.
 *
 * A click moves the DOM caret at once, but ProseMirror syncs its own selection
 * on a 20ms `flushSoon` timer. A key arriving inside that window is handled
 * against the *previous* selection — no hand is fast enough, but Playwright is
 * on most runs, and it strays for Tab and the arrow keys exactly as it does
 * for Enter. Waiting past the timer is what makes a click-then-key assertion
 * mean what it says.
 */
async function settle(page: Page, target: Locator) {
  await target.click();
  await page.waitForTimeout(100);
}

const clickCell = (page: Page, index: number) => settle(page, cells(page).nth(index));

/** Which cell holds the caret, as `r<row>c<col>`, or `outside` when it left. */
function caretCell(page: Page) {
  return page.evaluate(() => {
    const node = document.getSelection()?.anchorNode ?? null;
    if (!node) return 'none';
    const el = node.nodeType === 1 ? (node as Element) : node.parentElement;
    const cell = el?.closest('th,td');
    const row = cell?.closest('tr');
    const table = cell?.closest('table');
    if (!cell || !row || !table) return 'outside';
    const rows = Array.from(table.querySelectorAll('tr'));
    return `r${rows.indexOf(row)}c${Array.from(row.children).indexOf(cell)}`;
  });
}

const TABLE_DOC = ['| Term | Meaning |', '| --- | --- |', '| slot | One bookable cell |', ''].join(
  '\n',
);

test.describe('Table Enter, Shift+Enter and Tab (FR-5.7)', () => {
  test('Enter starts a new line inside the cell', async ({ page }) => {
    await docWithTable(page);
    await clickCell(page, 0);
    await expect.poll(() => caretCell(page)).toBe('r0c0');

    await page.keyboard.type('line one');
    await page.keyboard.press('Enter');
    // The caret stays put: Enter is about the text, not about navigating.
    await expect.poll(() => caretCell(page)).toBe('r0c0');
    await page.keyboard.type('line two');

    await expect(cells(page).first().locator('br[data-type="table-break"]')).toHaveCount(1);
    await expect(cells(page).first()).toHaveText('line oneline two');
    // The table keeps its shape, and the only paragraph is the empty one that
    // `trailingParagraph` keeps below every table-ending document.
    await expect(grid(page).locator('tr')).toHaveCount(3);
    await expect(editor(page).locator('> p')).toHaveCount(1);
    await expect(editor(page).locator('> p')).toHaveText('');
  });

  test('Enter writes a <br>, the only line break a cell can hold', async ({ page }) => {
    await openFile(page, 'break.md', TABLE_DOC);
    await settle(page, editor(page).locator('td', { hasText: 'One bookable cell' }));
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('in the calendar grid');

    // The break used to become a space here — silent content loss on save.
    expect(await save(page, 'break.md')).toContain('One bookable cell<br>in the calendar grid');
  });

  test('Shift+Enter breaks the line too, instead of doing nothing', async ({ page }) => {
    await openFile(page, 'shift.md', TABLE_DOC);
    await settle(page, editor(page).locator('td', { hasText: 'One bookable cell' }));
    await page.keyboard.press('End');
    // The keystroke was consumed and inserted nothing at all: a dead key.
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('second');

    await expect(
      editor(page).locator('td').last().locator('br[data-type="table-break"]'),
    ).toHaveCount(1);
    expect(await save(page, 'shift.md')).toContain('One bookable cell<br>second');
  });

  test('a <br> already in the file is a line break, not an HTML chip', async ({ page }) => {
    await openFile(
      page,
      'existing.md',
      ['| A | B |', '| --- | --- |', '| one<br>two | x<br />y |', ''].join('\n'),
    );
    await expect(editor(page).locator('br[data-type="table-break"]')).toHaveCount(2);
    await expect(editor(page).locator('.html-chip-inline')).toHaveCount(0);

    // Each spelling survives verbatim — the corpus holds html values to byte
    // equality, so the editor must not normalize `<br />` into `<br>`. Dirty a
    // cell without a break: `End` stops at the end of the *visual* line, so in
    // a broken cell it would land the edit mid-text and prove nothing.
    await settle(page, editor(page).locator('th').first());
    await page.keyboard.press('End');
    await page.keyboard.type('!');
    const saved = await save(page, 'existing.md');
    expect(saved).toContain('| A! |');
    expect(saved).toContain('one<br>two');
    expect(saved).toContain('x<br />y');
  });

  test('a pasted line break survives the save', async ({ page, browserName }) => {
    // Same driver limit as the FR-5.13 clipboard test: only Chromium honors a
    // programmatically-constructed clipboardData. The normalizer itself is
    // engine-agnostic.
    test.skip(browserName === 'firefox', 'Firefox ignores synthetic clipboardData');
    await openFile(page, 'paste.md', TABLE_DOC);
    await settle(page, editor(page).locator('td', { hasText: 'One bookable cell' }));
    await page.keyboard.press('End');
    // Rich HTML from Docs or a browser carries `<br>`, which the commonmark
    // hardbreak rule claims; unconverted it renders fine and then dies on save.
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.setData('text/html', '<p>one<br>two</p>');
      dt.setData('text/plain', '');
      document
        .querySelector('.ProseMirror')!
        .dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
    });
    await expect(editor(page).locator('br[data-type="table-break"]')).toHaveCount(1);

    expect(await save(page, 'paste.md')).toContain('One bookable cellone<br>two');
  });

  test('the arrow keys still move between cells', async ({ page }) => {
    await docWithTable(page);
    await clickCell(page, 0);
    await expect.poll(() => caretCell(page)).toBe('r0c0');

    // What Enter used to do, and the reason it no longer has to.
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => caretCell(page)).toBe('r1c0');
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => caretCell(page)).toBe('r2c0');
    await page.keyboard.press('ArrowUp');
    await expect.poll(() => caretCell(page)).toBe('r1c0');
  });

  test('Enter in the last row keeps the table intact', async ({ page }) => {
    await docWithTable(page);
    await clickCell(page, 6);
    await expect.poll(() => caretCell(page)).toBe('r2c0');
    await page.keyboard.press('Enter');

    // The preset routes Enter to ExitTable, which appends a paragraph after
    // the whole table. Ours wins everywhere in the table, bottom row included —
    // so the trailing paragraph count stays at the one kept there all along.
    await expect.poll(() => caretCell(page)).toBe('r2c0');
    await expect(grid(page).locator('tr')).toHaveCount(3);
    await expect(editor(page).locator('> p')).toHaveCount(1);
  });

  test('Ctrl+Enter leaves the table into the paragraph already kept below it', async ({ page }) => {
    await docWithTable(page);
    await clickCell(page, 3);
    await expect.poll(() => caretCell(page)).toBe('r1c0');
    await page.keyboard.press('ControlOrMeta+Enter');

    await expect.poll(() => caretCell(page)).toBe('outside');
    await page.keyboard.type('after the table');
    await expect(editor(page).locator('> p')).toHaveText('after the table');
    // The preset's ExitTable appends unconditionally; landing in the kept
    // paragraph instead is what stops the gap below the table from doubling.
    await expect(editor(page).locator('> p')).toHaveCount(1);
    await expect(grid(page).locator('tr')).toHaveCount(3);
  });

  test('Tab still moves to the next cell along', async ({ page }) => {
    await docWithTable(page);
    await clickCell(page, 0);
    await expect.poll(() => caretCell(page)).toBe('r0c0');

    await page.keyboard.press('Tab');
    await expect.poll(() => caretCell(page)).toBe('r0c1');
  });

  test('Tab in the last cell appends a row and lands in it', async ({ page }) => {
    await docWithTable(page);
    // The preset binds Tab to `goToNextCell(1)`, which returns false here — so
    // the bottom-right cell used to swallow the keystroke entirely.
    await clickCell(page, 8);
    await expect.poll(() => caretCell(page)).toBe('r2c2');

    await page.keyboard.press('Tab');
    await expect(grid(page).locator('tr')).toHaveCount(4);
    await expect.poll(() => caretCell(page)).toBe('r3c0');

    // The new row is a body row, not a second header row.
    await page.keyboard.type('grown');
    await expect(cells(page).nth(9)).toHaveText('grown');
  });
});
