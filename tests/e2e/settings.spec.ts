import { expect, test, type Page } from '@playwright/test';

import { pinMode, seedFakeFile, stubFsa } from './helpers';

/**
 * The settings dialog (FR-13): three ways in, one place the answer is kept,
 * and it survives a reload.
 */

const DOC = [
  '## Diagrams',
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

async function open(page: Page) {
  await pinMode(page, 'wysiwyg');
  await stubFsa(page);
  await seedFakeFile(page, 'settings.md', DOC);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/');
  await page.getByTestId('welcome-open').click();
}

/** Put a text selection on the heading — the bubble's one trigger. */
async function selectHeading(page: Page) {
  await page.locator('.ProseMirror h2').click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
}

/** Does this diagram overflow its own box? */
async function scrolls(page: Page) {
  return page.evaluate(() => {
    const host = document.querySelector<HTMLElement>('.diagram-node')!;
    return host.scrollWidth - host.clientWidth > 0;
  });
}

test.describe('settings (FR-13)', () => {
  test('opens from the toolbar, the menu, and Ctrl+,', async ({ page }) => {
    await open(page);

    await page.getByTestId('settings-open').click();
    await expect(page.getByTestId('settings-panel')).toBeVisible();

    // Esc closes, like every other panel.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('settings-panel')).toBeHidden();

    await page.keyboard.press('Control+Comma');
    await expect(page.getByTestId('settings-panel')).toBeVisible();
    // …and toggles back off.
    await page.keyboard.press('Control+Comma');
    await expect(page.getByTestId('settings-panel')).toBeHidden();

    await page.getByRole('button', { name: 'Open menu' }).click();
    await page.getByRole('menuitem', { name: /Settings/ }).click();
    await expect(page.getByTestId('settings-panel')).toBeVisible();
  });

  test('the diagram switch is off by default, and reports its state', async ({ page }) => {
    await open(page);
    await page.getByTestId('settings-open').click();

    const toggle = page.getByTestId('setting-diagram-scroll');
    await expect(toggle).toHaveAttribute('role', 'switch');
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    // Named by the row heading — a switch has no text of its own.
    await expect(toggle).toHaveAccessibleName(/Scroll wide diagrams/);
  });

  test('toggling it changes the diagram at once, and persists', async ({ page }) => {
    await open(page);
    await expect(page.locator('.diagram-node svg')).toBeVisible({ timeout: 30000 });
    expect(await scrolls(page)).toBe(false);

    await page.getByTestId('settings-open').click();
    await page.getByTestId('setting-diagram-scroll').click();
    await expect(page.getByTestId('setting-diagram-scroll')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await page.keyboard.press('Escape');

    // No re-render needed: the preference lives on the document root.
    expect(await scrolls(page)).toBe(true);

    const stored = await page.evaluate(() => localStorage.getItem('marknow.settings'));
    expect(stored).toContain('"diagramScroll":true');

    await page.reload();
    await page.getByTestId('welcome-open').click();
    await expect(page.locator('.diagram-node svg')).toBeVisible({ timeout: 30000 });
    expect(await scrolls(page)).toBe(true);

    // And back off again, without a reload.
    await page.keyboard.press('Control+Comma');
    await page.getByTestId('setting-diagram-scroll').click();
    await page.keyboard.press('Escape');
    expect(await scrolls(page)).toBe(false);
  });

  test('the quick-actions switch is off by default, and reports its state', async ({ page }) => {
    await open(page);
    await page.getByTestId('settings-open').click();

    const toggle = page.getByTestId('setting-bubble-menu');
    await expect(toggle).toHaveAttribute('role', 'switch');
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(toggle).toHaveAccessibleName(/Show quick actions on selection/);
  });

  test('turning quick actions on brings the bubble back at once, and persists', async ({
    page,
  }) => {
    await open(page);
    await selectHeading(page);
    await expect(page.locator('.milkdown-bubble-menu')).toHaveAttribute('data-show', 'false');

    await page.keyboard.press('Control+Comma');
    await page.getByTestId('setting-bubble-menu').click();
    await expect(page.getByTestId('setting-bubble-menu')).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');

    // No reload and no re-created editor: the running bubble watches the store.
    await selectHeading(page);
    await expect(page.locator('.milkdown-bubble-menu')).toHaveAttribute('data-show', 'true');

    const stored = await page.evaluate(() => localStorage.getItem('marknow.settings'));
    expect(stored).toContain('"bubbleMenu":true');

    await page.reload();
    await page.getByTestId('welcome-open').click();
    await selectHeading(page);
    await expect(page.locator('.milkdown-bubble-menu')).toHaveAttribute('data-show', 'true');

    // And away again, without a reload.
    await page.keyboard.press('Control+Comma');
    await page.getByTestId('setting-bubble-menu').click();
    await page.keyboard.press('Escape');
    await selectHeading(page);
    await expect(page.locator('.milkdown-bubble-menu')).toHaveAttribute('data-show', 'false');
  });
});
