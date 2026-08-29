import { expect, test, type Page } from '@playwright/test';

import { seedFakeFile, stubFsa } from './helpers';

/** M4 WYSIWYG UX polish: bubble menu (FR-5.4), slash menu (FR-5.5),
 *  block handles + insert-below (FR-5.6), empty-doc placeholder. */

const editor = (page: Page) => page.locator('.ProseMirror');

async function newWysiwygDoc(page: Page) {
  await page.goto('/');
  await page.getByTestId('welcome-new').click();
  // Generous timeout: the WYSIWYG engine is a lazy chunk that the dev server
  // cold-compiles on first navigation under parallel load.
  await expect(editor(page)).toBeVisible({ timeout: 30000 });
  await editor(page).click();
}

test.describe('WYSIWYG UX polish (M4)', () => {
  test('empty document shows a placeholder prompt', async ({ page }) => {
    await newWysiwygDoc(page);
    await expect(editor(page).locator('.is-empty')).toHaveAttribute('data-placeholder', /Type/);
    // Placeholder disappears once the block has content.
    await page.keyboard.type('written');
    await expect(editor(page).locator('.is-empty')).toHaveCount(0);
  });

  test('bubble menu formats a selection and reflects state (FR-5.4)', async ({ page }) => {
    await newWysiwygDoc(page);
    await page.keyboard.type('format me please');
    // Select the line as a TextSelection (Ctrl+A yields an AllSelection, which
    // the bubble intentionally ignores).
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+End');

    const bubble = page.locator('.milkdown-bubble-menu');
    await expect(bubble).toHaveAttribute('data-show', 'true');

    const bold = bubble.getByLabel('Bold (Ctrl+B)');
    await expect(bold).toHaveAttribute('aria-pressed', 'false');
    await bold.click();
    await expect(editor(page).locator('strong')).toHaveText('format me please');
    await expect(bold).toHaveAttribute('aria-pressed', 'true');

    // Turn-into converts the enclosing block. Click it first: `selectOption`
    // sets the value directly, so only a real click proves the menu's
    // mousedown handler still lets the control open.
    const turnInto = bubble.locator('.bubble-turn-into');
    await turnInto.click();
    await expect(turnInto).toBeFocused();
    await turnInto.selectOption('h2');
    await expect(editor(page).locator('h2')).toContainText('format me please');
  });

  test('bubble menu is hidden without a selection', async ({ page }) => {
    await newWysiwygDoc(page);
    await page.keyboard.type('no selection here');
    await expect(page.locator('.milkdown-bubble-menu')).toHaveAttribute('data-show', 'false');
  });

  test('slash menu filters and inserts by keyboard (FR-5.5)', async ({ page }) => {
    await newWysiwygDoc(page);
    await page.keyboard.type('/');

    const slash = page.locator('.milkdown-slash-menu');
    await expect(slash).toHaveAttribute('data-show', 'true');
    await expect(slash.locator('.slash-item')).toHaveCount(14);

    // Filter narrows to the three headings.
    await page.keyboard.type('head');
    await expect(slash.locator('.slash-item')).toHaveCount(3);
    await expect(slash.locator('.slash-item').first()).toContainText('Heading 1');
    // Wait for the active item to settle at the top before navigating (the
    // filter render resets it) — avoids a type-then-navigate race under load.
    await expect(slash.locator('.slash-item.active')).toContainText('Heading 1');

    // Arrow-down selects Heading 2, Enter inserts it (removing the "/head" text).
    await page.keyboard.press('ArrowDown');
    await expect(slash.locator('.slash-item.active')).toContainText('Heading 2');
    await page.keyboard.press('Enter');
    await expect(slash).toHaveAttribute('data-show', 'false');

    await page.keyboard.type('My Heading');
    await expect(editor(page).locator('h2')).toHaveText('My Heading');
    await expect(editor(page)).not.toContainText('/head');
  });

  test('slash menu inserts by click and closes on Escape (FR-5.5)', async ({ page }) => {
    await newWysiwygDoc(page);
    await page.keyboard.type('/table');
    const slash = page.locator('.milkdown-slash-menu');
    await expect(slash.locator('.slash-item')).toHaveCount(1);
    await slash.locator('.slash-item', { hasText: 'Table' }).click();
    await expect(editor(page).locator('table.children')).toBeVisible();

    // Escape dismisses the menu without inserting.
    await editor(page).click();
    await page.keyboard.press('End');
    await page.keyboard.type('/quote');
    await expect(slash).toHaveAttribute('data-show', 'true');
    await page.keyboard.press('Escape');
    await expect(slash).toHaveAttribute('data-show', 'false');
    await expect(editor(page).locator('blockquote')).toHaveCount(0);
  });

  test('list markers sit on their item’s first line and share one column', async ({ page }) => {
    await newWysiwygDoc(page);
    // The list-item component renders marker and content as separate flex
    // items, so nothing collapses the content block's own top margin — the
    // marker used to float ~12px above its own text.
    await page.keyboard.type('1. item 1');
    for (let i = 2; i <= 10; i += 1) {
      await page.keyboard.press('Enter');
      await page.keyboard.type(`item ${i}`);
    }
    await expect(editor(page).locator('ol .milkdown-list-item-block')).toHaveCount(10);

    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('ol > .milkdown-list-item-block')].map((wrapper) => {
        const label = wrapper.querySelector('.label') as HTMLElement;
        const firstBlock = wrapper.querySelector('.content-dom > *') as HTMLElement;
        const range = document.createRange();
        range.selectNodeContents(firstBlock);
        const text = range.getBoundingClientRect();
        const marker = label.getBoundingClientRect();
        return {
          label: label.textContent,
          offset: (text.top + text.bottom) / 2 - (marker.top + marker.bottom) / 2,
          markerRight: marker.right,
          textLeft: text.left,
        };
      }),
    );

    for (const row of rows) {
      // Marker and first line share a baseline (sub-pixel glyph metrics only).
      expect(Math.abs(row.offset), `marker ${row.label} vertical offset`).toBeLessThanOrEqual(2);
      // One content column and one marker edge, across the 9 → 10 digit change.
      expect(row.textLeft).toBeCloseTo(rows[0].textLeft, 0);
      expect(row.markerRight).toBeCloseTo(rows[0].markerRight, 0);
    }
  });

  test('list markers match the preview: disc bullets in the document colour (FR-4.4)', async ({
    page,
  }) => {
    await stubFsa(page);
    await seedFakeFile(
      page,
      'lists.md',
      '- bullet item\n\n1. ordered item\n\n- [ ] task item\n- [x] done item\n',
    );
    await page.goto('/');
    await page.getByTestId('welcome-open').click();
    await expect(editor(page)).toBeVisible({ timeout: 30000 });
    await expect(editor(page).locator('.milkdown-list-item-block')).toHaveCount(4);

    const markers = await page.evaluate(() => {
      const read = (selector: string) => {
        const label = document.querySelector<HTMLElement>(selector);
        if (!label) return null;
        const item = label.closest('.milkdown-list-item-block')!;
        const text = item.querySelector<HTMLElement>('.content-dom > *')!;
        return {
          glyph: label.textContent ?? '',
          color: getComputedStyle(label).color,
          textColor: getComputedStyle(text).color,
        };
      };
      return {
        bullet: read('.label.bullet'),
        ordered: read('.label.ordered'),
        unchecked: read('.label.unchecked'),
        checked: read('.label.checked'),
      };
    });

    // A plain disc, not the component's default `⦿` (U+29BF CIRCLED BULLET),
    // which reads as a selected radio button.
    expect(markers.bullet?.glyph).toBe('•');
    expect(markers.bullet?.glyph).not.toBe('⦿');

    // Markers are not controls, so they take the document's text colour like
    // the `::marker` the preview draws for the same markdown.
    expect(markers.bullet?.color).toBe(markers.bullet?.textColor);
    expect(markers.ordered?.color).toBe(markers.ordered?.textColor);

    // A checkbox *is* a control (clicking it toggles the item), so it keeps the
    // accent colour — the preview tints its checkbox for the same reason.
    expect(markers.unchecked?.color).not.toBe(markers.unchecked?.textColor);
    expect(markers.checked?.color).not.toBe(markers.checked?.textColor);
  });

  test('block handle appears on hover and inserts a block below (FR-5.6)', async ({ page }) => {
    await newWysiwygDoc(page);
    await page.keyboard.type('First block');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Second block');

    await editor(page).locator('p', { hasText: 'First block' }).hover();
    const handle = page.locator('.milkdown-block-handle');
    await expect(handle).toHaveAttribute('data-show', 'true');
    // The handle is draggable — reordering is powered by the block plugin.
    await expect(handle).toHaveAttribute('draggable', 'true');

    await handle.locator('.block-handle-add').click();
    await page.keyboard.type('Inserted');

    const texts = await editor(page).locator('p').allInnerTexts();
    expect(texts).toEqual(['First block', 'Inserted', 'Second block']);
  });
});
