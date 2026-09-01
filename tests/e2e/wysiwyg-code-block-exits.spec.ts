import { expect, test, type Page } from '@playwright/test';

/**
 * Getting *out* of a code block (FR-5.1). All live-typing behaviour, which is
 * why seeded-markdown specs never covered it.
 */

const editor = (page: Page) => page.locator('.ProseMirror');
const codeText = (page: Page) => editor(page).locator('.cm-content').first();

async function newWysiwygDoc(page: Page) {
  await page.goto('/');
  await page.getByTestId('welcome-new').click();
  // Generous timeout: the WYSIWYG engine is a lazy chunk that the dev server
  // cold-compiles on first navigation under parallel load.
  await expect(editor(page)).toBeVisible({ timeout: 30000 });
  await editor(page).click();
}

/** A document ending in a code block containing `const x = 1;`. */
async function docEndingInCodeBlock(page: Page) {
  await newWysiwygDoc(page);
  await page.keyboard.type('intro para');
  await page.keyboard.press('Enter');
  // The fence rule fires on ```<lang> + whitespace.
  await page.keyboard.type('```js ');
  await expect(editor(page).locator('.milkdown-code-block')).toHaveCount(1);
  await expect(codeText(page)).toBeVisible();
  // CodeMirror mounts lazily; typing before it holds focus splits the text
  // between the two editors.
  await codeText(page).click();
  await expect.poll(() => activeElement(page)).toContain('cm-content');
  await page.keyboard.type('const x = 1;');
  await expect(codeText(page)).toHaveText('const x = 1;');
}

/** Where DOM focus currently sits, as `TAG.className`. */
function activeElement(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    return el ? `${el.tagName}.${el.className}` : 'NONE';
  });
}

test.describe('Code block keyboard escapes (FR-5.1)', () => {
  test('Tab indents and Shift+Tab outdents without leaving the editor', async ({ page }) => {
    await docEndingInCodeBlock(page);
    await page.keyboard.press('Home');

    await page.keyboard.press('Tab');
    await expect(codeText(page)).toHaveText('  const x = 1;');
    // The caret must stay in the code editor — Tab used to hand focus to the
    // next focusable element and swallow every keystroke after it.
    expect(await activeElement(page)).toContain('cm-content');

    await page.keyboard.press('Shift+Tab');
    await expect(codeText(page)).toHaveText('const x = 1;');
  });

  test('Escape leaves the code block so it is never a keyboard trap', async ({ page }) => {
    await docEndingInCodeBlock(page);
    await page.keyboard.press('Escape');

    expect(await activeElement(page)).toContain('ProseMirror');
    await page.keyboard.type('after escape');
    await expect(editor(page).locator('p').last()).toHaveText('after escape');
    await expect(codeText(page)).toHaveText('const x = 1;');
  });

  test('Enter on a blank last line exits and consumes that line', async ({ page }) => {
    await docEndingInCodeBlock(page);
    // First Enter is an ordinary newline inside the fence… (asserted on
    // rendered lines: toHaveText trims, so a trailing newline is invisible).
    await page.keyboard.press('Enter');
    await expect(codeText(page).locator('.cm-line')).toHaveCount(2);
    // …the second, on the now-blank last line, leaves the block.
    await page.keyboard.press('Enter');

    await page.keyboard.type('AFTER');
    await expect(editor(page).locator('p').last()).toHaveText('AFTER');
    // The blank line goes with it rather than being left behind in the fence.
    await expect(codeText(page).locator('.cm-line')).toHaveCount(1);
    await expect(codeText(page)).toHaveText('const x = 1;');
  });

  test('clicking below a trailing code block appends a paragraph, not text at the top', async ({
    page,
  }) => {
    await docEndingInCodeBlock(page);
    const box = await editor(page).boundingBox();
    if (!box) throw new Error('editor has no box');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height - 4);

    await page.keyboard.type('ZZZ');
    await expect(editor(page).locator('p').last()).toHaveText('ZZZ');
    // The bug: posAtCoords fell back to position 0 and prepended to the first
    // paragraph instead.
    await expect(editor(page).locator('p').first()).toHaveText('intro para');
  });

  test('clicking below a plain paragraph does not add an empty one', async ({ page }) => {
    await newWysiwygDoc(page);
    await page.keyboard.type('first line');
    await page.keyboard.press('Enter');
    await page.keyboard.type('last line');

    const box = await editor(page).boundingBox();
    if (!box) throw new Error('editor has no box');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height - 4);

    await page.keyboard.type('!');
    await expect(editor(page).locator('p')).toHaveCount(2);
    await expect(editor(page).locator('p').last()).toHaveText('last line!');
  });

  test('block handle + focuses the paragraph it inserts (FR-5.6)', async ({ page }) => {
    await docEndingInCodeBlock(page);
    await editor(page).locator('.milkdown-code-block').first().hover();
    const add = page.locator('.milkdown-block-handle .block-handle-add');
    await expect(add).toBeVisible();
    await add.click();

    // Settle the interaction before typing: the handle is positioned
    // asynchronously, so a click that lands mid-reposition inserts nothing and
    // would otherwise surface as a confusing assertion on the typed text.
    // Three, not two: the intro paragraph, the inserted one, and the empty one
    // `trailingParagraph` keeps below a document ending in a code block.
    await expect(editor(page).locator('p')).toHaveCount(3);
    // This is the fix itself — focus used to bounce straight back into
    // CodeMirror, so the text landed in the fence instead.
    await expect.poll(() => activeElement(page)).toContain('ProseMirror');

    await page.keyboard.type('AAA');
    // The inserted paragraph, not the last one — the kept trailing paragraph
    // now sits after it.
    await expect(editor(page).locator('> p').nth(1)).toHaveText('AAA');
    await expect(codeText(page)).toHaveText('const x = 1;');
  });
});
