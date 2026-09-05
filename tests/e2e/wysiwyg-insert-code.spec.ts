import { expect, test, type Page } from '@playwright/test';

import { getFakeDisk, seedFakeFile, stubFsa } from './helpers';

/**
 * The toolbar's code button (and Ctrl+E) with no selection. Upstream's
 * `toggleInlineCodeCommand` opens with `if (selection.empty) return false`, so
 * both were dead on a bare caret — the one gesture a user makes when they want
 * to write code *next*, rather than mark code they have already written.
 *
 * A mark cannot span an empty range, so the two branches differ by necessity:
 * an empty line becomes a real fenced block, and anywhere else the mark is
 * armed for the next character and drawn as a chip until then.
 */

const editor = (page: Page) => page.locator('.ProseMirror');
const codeButton = (page: Page) =>
  page.getByTestId('wysiwyg-toolbar').getByLabel('Inline code (Ctrl+E)');
const chip = (page: Page) => page.locator('.mk-inline-code-caret');

async function newWysiwygDoc(page: Page) {
  await page.goto('/');
  await page.getByTestId('welcome-new').click();
  // Generous timeout: the WYSIWYG engine is a lazy chunk that the dev server
  // cold-compiles on first navigation under parallel load.
  await expect(editor(page)).toBeVisible({ timeout: 30000 });
  await editor(page).click();
}

test.describe('Code button with no selection (FR-5.2)', () => {
  test('a non-empty line arms inline code for the next character typed', async ({ page }) => {
    await newWysiwygDoc(page);
    await page.keyboard.type('run ');

    await codeButton(page).click();
    await expect(chip(page)).toHaveCount(1);
    await expect(codeButton(page)).toHaveAttribute('aria-pressed', 'true');
    // Armed, not written: still one plain paragraph, no fence.
    await expect(editor(page).locator('.milkdown-code-block')).toHaveCount(0);

    await page.keyboard.type('npm i');
    await expect(editor(page).locator('p code')).toHaveText('npm i');
    await expect(chip(page)).toHaveCount(0);
  });

  test('a second press disarms it again', async ({ page }) => {
    await newWysiwygDoc(page);
    await page.keyboard.type('run ');

    await codeButton(page).click();
    await expect(chip(page)).toHaveCount(1);
    await codeButton(page).click();
    await expect(chip(page)).toHaveCount(0);
    await expect(codeButton(page)).toHaveAttribute('aria-pressed', 'false');

    await page.keyboard.type('plain');
    await expect(editor(page).locator('p code')).toHaveCount(0);
    await expect(editor(page).locator('p').first()).toHaveText('run plain');
  });

  test('an empty line becomes a code block with the caret inside it', async ({ page }) => {
    await newWysiwygDoc(page);
    await page.keyboard.type('intro');
    await page.keyboard.press('Enter');

    await codeButton(page).click();
    const block = editor(page).locator('.milkdown-code-block');
    await expect(block).toHaveCount(1);
    // Focus lands in the block's own CodeMirror, not on the toolbar or the
    // outer document — the failure mode that made every other exit-a-code-block
    // path silently swallow keystrokes.
    await expect(page.locator('.milkdown-code-block .cm-content')).toBeFocused();

    await page.keyboard.type('const x = 1;');
    await expect(block.locator('.cm-content')).toHaveText('const x = 1;');
    await expect(editor(page).locator('p').first()).toHaveText('intro');
  });

  test('the block it creates saves as a plain fence', async ({ page }) => {
    await stubFsa(page);
    await seedFakeFile(page, 'code.md', 'intro\n');
    await page.goto('/');
    await page.getByTestId('welcome-open').click();
    await expect(editor(page)).toBeVisible({ timeout: 30000 });

    await editor(page).locator('p').first().click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await codeButton(page).click();
    await expect(page.locator('.milkdown-code-block .cm-content')).toBeFocused();
    await page.keyboard.type('const x = 1;');
    await page.waitForTimeout(600); // push debounce

    await page.keyboard.press('ControlOrMeta+s');
    await expect(page.getByTestId('status-save')).toContainText('Saved');
    expect((await getFakeDisk(page))['code.md']).toBe('intro\n\n```\nconst x = 1;\n```\n');
  });

  test('arming writes nothing when the caret moves away', async ({ page }) => {
    await stubFsa(page);
    await seedFakeFile(page, 'clean.md', 'Run the command.\n');
    await page.goto('/');
    await page.getByTestId('welcome-open').click();
    await expect(editor(page)).toBeVisible({ timeout: 30000 });

    await editor(page).locator('p').first().click();
    await codeButton(page).click();
    await expect(chip(page)).toHaveCount(1);

    await page.keyboard.press('ArrowLeft');
    await expect(chip(page)).toHaveCount(0);
    await page.waitForTimeout(600); // let any stray push settle
    await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
    await expect(editor(page).locator('p').first()).toHaveText('Run the command.');
  });

  test('a table cell falls back to inline code, since a fence cannot live there', async ({
    page,
  }) => {
    await newWysiwygDoc(page);
    await page.getByTestId('wysiwyg-toolbar').getByLabel('Insert table').click();
    await editor(page).locator('th').first().click();

    await codeButton(page).click();
    await expect(editor(page).locator('.milkdown-code-block')).toHaveCount(0);
    await expect(chip(page)).toHaveCount(1);

    await page.keyboard.type('npm');
    await expect(editor(page).locator('th code').first()).toHaveText('npm');
  });

  test('a selection still toggles the mark, as it always did', async ({ page }) => {
    await newWysiwygDoc(page);
    await page.keyboard.type('run npm i now');
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft');
    for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowLeft');

    await codeButton(page).click();
    await expect(editor(page).locator('p code')).toHaveText('npm i');
    await expect(editor(page).locator('.milkdown-code-block')).toHaveCount(0);

    await codeButton(page).click();
    await expect(editor(page).locator('p code')).toHaveCount(0);
  });

  test('Ctrl+E takes both branches, exactly as the button does', async ({ page }) => {
    await newWysiwygDoc(page);
    await page.keyboard.type('run ');

    await page.keyboard.press('ControlOrMeta+e');
    await page.keyboard.type('npm i');
    await expect(editor(page).locator('p code')).toHaveText('npm i');

    await page.keyboard.press('Enter');
    await page.keyboard.press('ControlOrMeta+e');
    await expect(editor(page).locator('.milkdown-code-block')).toHaveCount(1);
    await expect(page.locator('.milkdown-code-block .cm-content')).toBeFocused();
  });
});
