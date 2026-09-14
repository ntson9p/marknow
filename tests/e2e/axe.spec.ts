import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { pinMode, pinTheme, seedFakeFile, stubFsa } from './helpers';

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const DOC =
  '# Heading\n\n## Section\n\nSome **bold** and *italic* text with a [link](https://example.com).\n\n' +
  '- one\n- two\n\n> A quote.\n\n```js\nconst x = 1;\n```\n';

interface Violation {
  id: string;
  impact?: string | null;
  nodes: { target: unknown[]; html?: string; any?: { data?: unknown }[] }[];
}

/** Fail only on serious/critical issues (M7 done-when: "no serious violations"). */
async function scanSerious(page: Page): Promise<Violation[]> {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  return results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  ) as Violation[];
}

function summarize(violations: Violation[]): string {
  return violations
    .flatMap((v) =>
      v.nodes.map(
        (n) =>
          `${v.impact} | ${v.id} -> ${JSON.stringify(n.target)} | ${n.html?.slice(0, 90)} | ${JSON.stringify(n.any?.[0]?.data)}`,
      ),
    )
    .join('\n');
}

async function openDoc(page: Page, mode: 'raw' | 'wysiwyg') {
  await stubFsa(page);
  await seedFakeFile(page, 'doc.md', DOC);
  await pinMode(page, mode);
  await page.goto('/');
  await page.getByTestId('welcome-open').click();
}

test.describe('accessibility audit (axe, no serious violations)', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`welcome screen (${theme})`, async ({ page }) => {
      await pinTheme(page, theme);
      await page.goto('/');
      await expect(page.getByTestId('welcome-open')).toBeVisible();
      const v = await scanSerious(page);
      expect(v.length, summarize(v)).toBe(0);
    });

    test(`WYSIWYG mode (${theme})`, async ({ page }) => {
      await pinTheme(page, theme);
      await openDoc(page, 'wysiwyg');
      await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 30000 });
      const v = await scanSerious(page);
      expect(v.length, summarize(v)).toBe(0);
    });
  }

  test('raw mode with preview', async ({ page }) => {
    await openDoc(page, 'raw');
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 30000 });
    const v = await scanSerious(page);
    expect(v.length, summarize(v)).toBe(0);
  });

  test('table size picker', async ({ page }) => {
    await openDoc(page, 'wysiwyg');
    await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 30000 });
    await page.getByTestId('wysiwyg-toolbar').getByRole('button', { name: 'Insert table' }).click();
    await expect(page.getByTestId('table-size-picker')).toBeVisible();
    const v = await scanSerious(page);
    expect(v.length, summarize(v)).toBe(0);
  });

  test('metadata dialog', async ({ page }) => {
    await stubFsa(page);
    await seedFakeFile(page, 'doc.md', '---\ntitle: T\ntags: [a, b]\n---\n\n# Doc\n');
    await pinMode(page, 'wysiwyg');
    await page.goto('/');
    await page.getByTestId('welcome-open').click();
    await page.getByRole('button', { name: 'Open menu' }).click();
    await page.getByRole('menuitem', { name: 'Metadata' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    const v = await scanSerious(page);
    expect(v.length, summarize(v)).toBe(0);
  });
});
