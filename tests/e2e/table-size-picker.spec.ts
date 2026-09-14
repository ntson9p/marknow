import { expect, test, type Page } from '@playwright/test';

import { insertTable, pinMode, seedFakeFile, stubFsa } from './helpers';

/**
 * Table size picker (FR-5.2): the toolbar's table button opens a grid, and the
 * cell you land on is the table you get. Rows count the header row.
 */

const editor = (page: Page) => page.locator('.ProseMirror');
/** `.mk-table-grid` is the NodeView's grid; its tbody holds the rows. */
const grid = (page: Page) => editor(page).locator('table.mk-table-grid');
const button = (page: Page) =>
  page.getByTestId('wysiwyg-toolbar').getByRole('button', { name: 'Insert table' });
const picker = (page: Page) => page.getByTestId('table-size-picker');
const sizeLabel = (page: Page) => page.getByTestId('table-size-label');
const cell = (page: Page, row: number, col: number) =>
  picker(page).locator(`[data-cell="${row}x${col}"]`);

async function newWysiwygDoc(page: Page) {
  await page.goto('/');
  await page.getByTestId('welcome-new').click();
  // WYSIWYG is the default mode (D3); the engine is a lazy chunk.
  await expect(editor(page)).toBeVisible({ timeout: 30000 });
  await editor(page).click();
}

test.describe('table size picker (FR-5.2)', () => {
  test('hovering the button opens the grid, and the size follows the pointer', async ({ page }) => {
    await newWysiwygDoc(page);
    await button(page).hover();

    await expect(picker(page)).toBeVisible();
    await expect(sizeLabel(page)).toHaveText('3 × 3');

    await cell(page, 5, 4).hover();
    await expect(sizeLabel(page)).toHaveText('5 × 4');
    // Still just a preview: nothing is inserted until a cell is clicked.
    await expect(grid(page)).toHaveCount(0);
  });

  test('the picked cell is the table that lands in the document', async ({ page }) => {
    await newWysiwygDoc(page);
    await insertTable(page, 5, 4);

    await expect(grid(page)).toBeVisible();
    await expect(grid(page).locator('tr')).toHaveCount(5);
    await expect(grid(page).locator('th')).toHaveCount(4);
  });

  test('the top row of the grid picks two rows, never a lone header', async ({ page }) => {
    await newWysiwygDoc(page);
    await button(page).click();
    await cell(page, 1, 3).hover();
    await expect(sizeLabel(page)).toHaveText('2 × 3');

    await cell(page, 1, 3).click();
    await expect(grid(page).locator('tr')).toHaveCount(2);
    await expect(grid(page).locator('th')).toHaveCount(3);
  });

  test('the grid takes the keyboard: Enter opens it, arrows size it, Enter inserts', async ({
    page,
  }) => {
    await newWysiwygDoc(page);
    await button(page).focus();
    await page.keyboard.press('Enter');
    await expect(picker(page)).toBeVisible();

    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await expect(sizeLabel(page)).toHaveText('4 × 4');

    await page.keyboard.press('Enter');
    await expect(picker(page)).toBeHidden();
    await expect(grid(page).locator('tr')).toHaveCount(4);
    await expect(grid(page).locator('th')).toHaveCount(4);
  });

  test('Escape closes the grid, inserting nothing', async ({ page }) => {
    await newWysiwygDoc(page);
    await button(page).click();
    await expect(picker(page)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(picker(page)).toBeHidden();
    await expect(grid(page)).toHaveCount(0);
  });

  test('a grid open over the document leaves the caret where it was', async ({ page }) => {
    await newWysiwygDoc(page);
    await page.keyboard.type('before');
    await button(page).hover();
    await expect(picker(page)).toBeVisible();

    await page.keyboard.type(' after');
    await expect(editor(page).locator('p').first()).toHaveText('before after');
  });

  test('on a phone the grid clears the viewport edges', async ({ page }) => {
    const PHONE = { width: 390, height: 780 };
    await page.setViewportSize(PHONE);
    await newWysiwygDoc(page);
    // At this width the toolbar is one scrolling row, and it clips its own
    // overflow — the panel is portalled out of it for exactly that reason.
    await button(page).scrollIntoViewIfNeeded();
    await button(page).click();
    await expect(picker(page)).toBeVisible();

    const box = (await picker(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width);
    expect(box.y + box.height).toBeLessThanOrEqual(PHONE.height);
  });

  test('dual mode writes the picked size into the source pane', async ({ page }) => {
    await stubFsa(page);
    await seedFakeFile(page, 'dual.md', 'intro\n');
    await pinMode(page, 'dual');
    await page.goto('/');
    await page.getByTestId('welcome-open').click();
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 30000 });
    await expect(editor(page)).toBeVisible({ timeout: 30000 });

    await page.locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+End');
    await insertTable(page, 2, 4);

    // Compact table style (FR-13.2 default) — matches the WYSIWYG serializer.
    const lines = page.locator('.cm-line');
    await expect(lines.filter({ hasText: '| - | - | - | - |' })).toHaveCount(1);
    await expect(grid(page).locator('th')).toHaveCount(4);
    await expect(grid(page).locator('tr')).toHaveCount(2);
  });
});
