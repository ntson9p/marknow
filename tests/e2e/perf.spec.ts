import { expect, test } from '@playwright/test';

import { seedFakeFile, stubFsa } from './helpers';

/** Build a roughly `targetBytes` markdown document of realistic blocks. */
function bigDoc(targetBytes: number): string {
  const block =
    '## Section heading\n\nA paragraph of reasonably realistic prose repeated to build a large ' +
    'document for the performance budget. It has **bold**, *italic*, and `code`, plus a ' +
    '[link](https://example.com).\n\n- item one\n- item two\n- item three\n\n';
  let out = '# Large document\n\n';
  while (out.length < targetBytes) out += block;
  return out;
}

test.describe('large document behaviour (§7, 1 MB)', () => {
  test('a 1 MB document opens and stays editable in raw mode', async ({ page, browserName }) => {
    // Perf smoke is sufficient on one engine; skip the slower duplicate run.
    test.skip(browserName === 'firefox', 'perf smoke runs on chromium');

    const doc = bigDoc(1_000_000);
    // Preview is the heavy part on 1 MB and the budget lets it degrade — open
    // with it off so the check targets "opens and remains editable".
    await page.addInitScript(() => {
      localStorage.setItem(
        'marknow.ui',
        JSON.stringify({ version: 0, state: { mode: 'raw', rawPreviewVisible: false } }),
      );
    });
    await stubFsa(page);
    await seedFakeFile(page, 'big.md', doc);
    await page.goto('/');

    const started = Date.now();
    await page.getByTestId('welcome-open').click();
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 30000 });
    const openMs = Date.now() - started;
    expect(openMs, `1 MB open took ${openMs}ms`).toBeLessThan(20000);

    // Still editable: an edit at the top lands in the document.
    await page.locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+Home');
    await page.keyboard.type('EDITED ');
    await expect(page.locator('.cm-content')).toContainText('EDITED # Large document');
  });
});
