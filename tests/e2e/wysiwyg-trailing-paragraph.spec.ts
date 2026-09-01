import { expect, test, type Page } from '@playwright/test';

import { getFakeDisk, seedFakeFile, stubFsa } from './helpers';

/**
 * A way out of a document that ends in a block the caret cannot leave
 * (FR-5.6), as Docs and Word both provide.
 *
 * The point of keeping the paragraph rather than adding one on demand is that
 * it needs no discovery: it is visibly there, clickable, and the arrow keys
 * reach it. The point of dropping it on serialize is that the file must not
 * change because the editor wanted somewhere to put a caret.
 */

const editor = (page: Page) => page.locator('.ProseMirror');
const grid = (page: Page) => editor(page).locator('table.mk-table-grid');
/** Top-level paragraphs only — cell contents are paragraphs too. */
const paras = (page: Page) => editor(page).locator('> p');

const TABLE_DOC = [
  '## Glossary',
  '',
  '| Term | Meaning |',
  '| --- | --- |',
  '| slot | One bookable cell |',
  '| frame | A settings document |',
  '',
].join('\n');

async function openFile(page: Page, name: string, body: string) {
  await stubFsa(page);
  await seedFakeFile(page, name, body);
  await page.addInitScript((n) => {
    (window as unknown as Record<string, unknown>).__openFileName = n;
  }, name);
  await page.goto('/');
  await page.getByTestId('welcome-open').click();
  await expect(editor(page)).toBeVisible({ timeout: 30000 });
}

test.describe('trailing paragraph below an unexitable block (FR-5.6)', () => {
  test('a document ending in a table gets a caret-sized way out', async ({ page }) => {
    await openFile(page, 'table.md', TABLE_DOC);
    await expect(grid(page)).toBeVisible();
    await expect(paras(page)).toHaveCount(1);

    // Not a zero-height artifact — a line you can actually aim at.
    const box = await paras(page).boundingBox();
    expect(box!.height).toBeGreaterThan(12);

    await paras(page).click();
    await page.keyboard.type('below the table');
    await expect(paras(page)).toHaveText('below the table');
  });

  test('it does not change the file, and does not mark it dirty', async ({ page }) => {
    await openFile(page, 'clean.md', TABLE_DOC);
    await expect(grid(page)).toBeVisible();
    await expect(paras(page)).toHaveCount(1);

    // 'Unsaved changes' is the dirty label; this one is the clean-state label.
    await expect(page.getByTestId('status-save')).toHaveText('Not saved yet');

    await editor(page).click();
    await page.waitForTimeout(600);
    await page.keyboard.press('ControlOrMeta+s');
    await expect(page.getByTestId('status-save')).toContainText('Saved');
    // Byte-identical: the kept paragraph costs one newline, which
    // `normalizeSerialized` drops.
    expect((await getFakeDisk(page))['clean.md']).toBe(TABLE_DOC);
  });

  test('ArrowDown out of the last row lands in it', async ({ page }) => {
    await openFile(page, 'arrow.md', TABLE_DOC);
    await expect(grid(page)).toBeVisible();
    await editor(page).locator('td').last().click();
    await page.waitForTimeout(100); // let the view's selection catch up

    await page.keyboard.press('ArrowDown');
    await page.keyboard.type('arrived');
    await expect(paras(page)).toHaveText('arrived');
    await expect(grid(page).locator('tr')).toHaveCount(3);
  });

  test('Backspace in it steps into the table instead of selecting it', async ({ page }) => {
    await openFile(page, 'back.md', TABLE_DOC);
    await expect(grid(page)).toBeVisible();
    await paras(page).click();
    await page.waitForTimeout(100);

    await page.keyboard.press('Backspace');
    await page.keyboard.type('X');

    // The default `joinBackward` selects the whole table here, so the very next
    // keystroke replaced it — a one-key way to lose a table, handed to the user
    // by a paragraph they never asked for.
    await expect(grid(page)).toBeVisible();
    await expect(editor(page).locator('td').last()).toHaveText('A settings documentX');
    await expect(paras(page)).toHaveCount(1);
  });

  test('a document ending in a code block gets one too', async ({ page }) => {
    await openFile(
      page,
      'code.md',
      ['intro para', '', '```ts', 'const x = 1;', '```', ''].join('\n'),
    );
    await expect(editor(page).locator('.milkdown-code-block')).toBeVisible({ timeout: 30000 });
    // The intro paragraph plus the kept one.
    await expect(paras(page)).toHaveCount(2);
    await expect(paras(page).last()).toHaveText('');
  });

  test('a document already ending in a paragraph gets nothing extra', async ({ page }) => {
    await openFile(page, 'plain.md', ['intro para', '', 'last para', ''].join('\n'));
    await expect(paras(page)).toHaveCount(2);
    await expect(paras(page).last()).toHaveText('last para');
  });

  test('clicking the blank area below the page continues the document', async ({ page }) => {
    await openFile(page, 'blank.md', TABLE_DOC);
    await expect(grid(page)).toBeVisible();

    // The bottom of the page card, as far down as anyone would plausibly aim.
    const card = (await page.getByTestId('wysiwyg-page').boundingBox())!;
    await page.mouse.click(card.x + card.width / 2, card.y + card.height - 8);
    await page.keyboard.type('continued');

    // Landing anywhere is not enough: focus survives a click on a plain div, so
    // the text could simply appear wherever the caret already was.
    await expect(paras(page)).toHaveText('continued');
    await expect(grid(page).locator('tr')).toHaveCount(3);
  });

  test('the blank area works for an ordinary document too', async ({ page }) => {
    // Nothing about this is table-specific — the dead zone was at the bottom of
    // every page, whatever the last block happened to be.
    await openFile(page, 'plainblank.md', ['# Title', '', 'only paragraph', ''].join('\n'));
    await expect(editor(page).locator('h1')).toBeVisible();

    const card = (await page.getByTestId('wysiwyg-page').boundingBox())!;
    await page.mouse.click(card.x + card.width / 2, card.y + card.height - 8);
    await page.keyboard.type('!');

    await expect(paras(page).last()).toHaveText('only paragraph!');
    await expect(paras(page)).toHaveCount(1);
  });

  test('the gap cursor between two blocks is drawn', async ({ page }) => {
    // Two adjacent tables: a caret clicked into the margin between them has
    // nowhere to sit but a gap cursor, which `plugin-cursor` creates and whose
    // stylesheet is never imported — so it used to have no size, no rule and no
    // colour, and the caret was simply invisible.
    await openFile(
      page,
      'gap.md',
      ['| A |', '| --- |', '| 1 |', '', '| B |', '| --- |', '| 2 |', ''].join('\n'),
    );
    await expect(grid(page)).toHaveCount(2);

    const tables = editor(page).locator('div.mk-table');
    const first = (await tables.first().boundingBox())!;
    const second = (await tables.last().boundingBox())!;
    await page.mouse.click(first.x + 8, (first.y + first.height + second.y) / 2);

    const cursor = page.locator('.ProseMirror-gapcursor');
    await expect(cursor).toHaveCount(1);
    // The element is zero-size by design — the rule is drawn by `::after`, so
    // that is what has to be asserted on.
    const drawn = await cursor.evaluate((el) => {
      const after = getComputedStyle(el, '::after');
      return {
        display: getComputedStyle(el).display,
        border: parseFloat(after.borderTopWidth),
        width: parseFloat(after.width),
      };
    });
    expect(drawn.display).toBe('block');
    expect(drawn.border).toBeGreaterThan(0);
    expect(drawn.width).toBeGreaterThan(0);
  });
});
