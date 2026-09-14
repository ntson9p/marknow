import { expect, test, type Page } from '@playwright/test';

import { getFakeDisk, insertTable, seedFakeFile, stubFsa } from './helpers';

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
    await expect(chip(page)).toBeVisible();
    await expect(codeButton(page)).toHaveAttribute('aria-pressed', 'true');
    // Armed, not written: still one plain paragraph, no fence.
    await expect(editor(page).locator('.milkdown-code-block')).toHaveCount(0);

    await page.keyboard.type('npm i');
    await expect(editor(page).locator('p code')).toHaveText('npm i');
    await expect(chip(page)).toBeHidden();
  });

  test('a second press disarms it again', async ({ page }) => {
    await newWysiwygDoc(page);
    await page.keyboard.type('run ');

    await codeButton(page).click();
    await expect(chip(page)).toBeVisible();
    await codeButton(page).click();
    await expect(chip(page)).toBeHidden();
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
    await expect(chip(page)).toBeVisible();

    await page.keyboard.press('ArrowLeft');
    await expect(chip(page)).toBeHidden();
    await page.waitForTimeout(600); // let any stray push settle
    await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
    await expect(editor(page).locator('p').first()).toHaveText('Run the command.');
  });

  test('a table cell falls back to inline code, since a fence cannot live there', async ({
    page,
  }) => {
    await newWysiwygDoc(page);
    await insertTable(page);
    await editor(page).locator('th').first().click();

    await codeButton(page).click();
    await expect(editor(page).locator('.milkdown-code-block')).toHaveCount(0);
    await expect(chip(page)).toBeVisible();

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

  // The chip is drawn outside the editable surface for a reason, and these two
  // assert the reason rather than the mechanism. Every other test here checks
  // serialized markup, and markup is exactly what stayed correct while the
  // caret was visibly dropping onto a line of its own.
  test('arming at the end of a line moves neither the caret nor the paragraph', async ({
    page,
  }) => {
    await newWysiwygDoc(page);
    await page.keyboard.type('you');
    await page.keyboard.press('Enter');
    await page.keyboard.type('are');

    const measure = () =>
      page.evaluate(() => {
        const sel = window.getSelection();
        const range = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
        range?.collapse(true);
        const para = document.querySelector('.ProseMirror p:last-of-type');
        return {
          caretTop: range?.getBoundingClientRect().top ?? null,
          paraHeight: para?.getBoundingClientRect().height ?? null,
          paraHTML: para?.innerHTML ?? null,
        };
      });

    const before = await measure();
    await codeButton(page).click();
    await expect(chip(page)).toBeVisible();
    const after = await measure();

    // A widget decoration here made ProseMirror append a trailing <br> to keep
    // the position after it selectable, which opened a second line box: the
    // paragraph doubled in height and the caret rendered on the new line.
    expect(after.paraHeight).toBe(before.paraHeight);
    expect(after.caretTop).toBe(before.caretTop);
    // The document itself must not gain so much as a hack node.
    expect(after.paraHTML).toBe('are');
  });

  test('the chip stands exactly where the real span will, flush after the text', async ({
    page,
  }) => {
    await newWysiwygDoc(page);
    await page.keyboard.type('you');
    await page.keyboard.press('Enter');
    await page.keyboard.type('are');

    // Right edge of the word, and what a genuine empty <code> would measure in
    // this very document — so the assertions below hard-code no pixel values.
    const reference = await page.evaluate(() => {
      const para = document.querySelector('.ProseMirror p:last-of-type')!;
      const range = document.createRange();
      range.selectNodeContents(para.firstChild!);

      const probe = document.createElement('p');
      probe.style.position = 'absolute';
      probe.style.visibility = 'hidden';
      probe.innerHTML = '<code></code>';
      document.querySelector('.wysiwyg-root')!.appendChild(probe);
      const emptyWidth = probe.querySelector('code')!.getBoundingClientRect().width;
      probe.remove();

      return { wordEnd: range.getBoundingClientRect().right, emptyWidth };
    });

    await codeButton(page).click();
    await expect(chip(page)).toBeVisible();
    const armed = await page.evaluate(() => {
      const r = document.querySelector('.mk-inline-code-caret')!.getBoundingClientRect();
      return { left: r.left, width: r.width };
    });

    // Insetting the chip to sit around the caret put its left edge 5px *inside*
    // the previous word, which read as the chip being welded to it.
    expect(armed.left).toBeCloseTo(reference.wordEnd, 0);
    expect(armed.width).toBeCloseTo(reference.emptyWidth, 0);

    // ...and the span that replaces it starts in the same place, so the grey
    // never jumps — it only grows.
    await page.keyboard.type('here');
    await expect(editor(page).locator('p code')).toHaveText('here');
    const codeLeft = await page.evaluate(
      () => document.querySelector('.ProseMirror p code')!.getBoundingClientRect().left,
    );
    expect(codeLeft).toBeCloseTo(armed.left, 0);
  });

  test('the chip tracks the text when the document scrolls', async ({ page }) => {
    // The plugin registers no scroll listener: it relies on the scroll
    // container being an *ancestor* of `.wysiwyg-root`, so chip and text share
    // one coordinate space. Restructure the layout so the editor scrolls
    // itself and the chip would drift — this is what notices.
    await stubFsa(page);
    await seedFakeFile(
      page,
      'long.md',
      [
        '# Long',
        '',
        'anchor line here',
        '',
        ...Array.from({ length: 40 }, (_, i) => `Filler ${i}.\n`),
      ].join('\n'),
    );
    await page.goto('/');
    await page.getByTestId('welcome-open').click();
    await expect(editor(page)).toBeVisible({ timeout: 30000 });

    await editor(page).locator('p', { hasText: 'anchor line here' }).click();
    await page.keyboard.press('End');
    await codeButton(page).click();
    await expect(chip(page)).toBeVisible();

    const offset = () =>
      page.evaluate(() => {
        const el = document.querySelector('.mk-inline-code-caret') as HTMLElement | null;
        const para = [...document.querySelectorAll('.ProseMirror p')].find((p) =>
          p.textContent?.includes('anchor line here'),
        );
        if (!el || el.hidden || !para) return null;
        return el.getBoundingClientRect().top - para.getBoundingClientRect().top;
      });

    const before = await offset();
    await page.mouse.move(600, 400);
    await page.mouse.wheel(0, 250);
    await page.waitForTimeout(300);

    expect(await offset()).toBeCloseTo(before as number, 1);
  });

  test('the chip is drawn outside the editable surface', async ({ page }) => {
    await newWysiwygDoc(page);
    await page.keyboard.type('run ');
    await codeButton(page).click();
    await expect(chip(page)).toBeVisible();

    const placement = await page.evaluate(() => {
      const el = document.querySelector('.mk-inline-code-caret');
      return {
        insideEditable: !!el?.closest('.ProseMirror'),
        parent: el?.parentElement?.className ?? null,
      };
    });
    expect(placement.insideEditable).toBe(false);
    expect(placement.parent).toContain('wysiwyg-root');
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
