import { expect, test, type Page } from '@playwright/test';

import { getFakeDisk, seedFakeFile, stubFsa } from './helpers';

/** A nontrivial document exercising most of the flavor table (§6). */
const README = [
  '# MarkYou Sample',
  '',
  'A paragraph with **bold**, *italic*, `code`, ~~strike~~ and a [link](https://example.com).',
  '',
  '## Features',
  '',
  '- tight item one',
  '- tight item two',
  '',
  '1. ordered one',
  '2. ordered two',
  '',
  '- [x] shipped',
  '- [ ] pending',
  '',
  '> [!warning] Careful',
  '> Callouts render as styled boxes.',
  '',
  '| Col A | Col B |',
  '| ----- | ----- |',
  '| 1     | 2     |',
  '',
  '```ts',
  'const x: number = 1;',
  '```',
  '',
  'Inline math $e^{i\\pi}+1=0$ and a block:',
  '',
  '$$',
  '\\int_0^1 x\\,dx',
  '$$',
  '',
  '<div class="custom">raw html block</div>',
  '',
  '[unused-def]: https://example.com/kept "Kept definition"',
  '',
  'The end.',
].join('\n');

/** A table with distinguishable cells for the FR-5.7 handle tests. */
const TABLE_DOC = [
  '## Glossary',
  '',
  '| Term | Meaning |',
  '| --- | --- |',
  '| slot | One bookable time cell |',
  '| frame | A settings document |',
  '| parent | Base reservation |',
  '',
].join('\n');

/** A tight nested list beside a loose one, for the FR-4.4 spacing test. */
const LIST_DOC = [
  '- one',
  '- two',
  '  - nested a',
  '  - nested b',
  '- three',
  '',
  '# divider',
  '',
  '- loose one',
  '',
  '  second paragraph',
  '',
  '- loose two',
  '',
].join('\n');

async function newWysiwygDoc(page: Page) {
  await page.goto('/');
  await page.getByTestId('welcome-new').click();
  // WYSIWYG is the default mode (D3); the engine is a lazy chunk.
  await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 15000 });
  await page.locator('.ProseMirror').click();
}

const editor = (page: Page) => page.locator('.ProseMirror');

test.describe('WYSIWYG mode (FR-5)', () => {
  test('typing with input rules produces headings, emphasis and lists (FR-5.3)', async ({
    page,
  }) => {
    await newWysiwygDoc(page);

    await page.keyboard.type('# Title');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Some **bold** move');
    await page.keyboard.press('Enter');
    await page.keyboard.type('- item one');

    await expect(editor(page).locator('h1')).toHaveText('Title');
    await expect(editor(page).locator('strong')).toHaveText('bold');
    await expect(editor(page).locator('ul li')).toContainText('item one');
    // Zero syntax leakage: markers were consumed, not rendered.
    await expect(editor(page)).not.toContainText('#');
    await expect(editor(page)).not.toContainText('**');
  });

  test('toolbar formats the selection and reflects its state (FR-5.2)', async ({ page }) => {
    await newWysiwygDoc(page);
    await page.keyboard.type('make me strong');
    await page.keyboard.press('ControlOrMeta+a');

    const bold = page.getByRole('button', { name: 'Bold (Ctrl+B)' });
    await expect(bold).toHaveAttribute('aria-pressed', 'false');
    await bold.click();
    await expect(editor(page).locator('strong')).toHaveText('make me strong');
    await expect(bold).toHaveAttribute('aria-pressed', 'true');

    // Block type dropdown converts the paragraph to a heading.
    await page.getByTestId('block-type-trigger').click();
    await page.getByRole('menuitem', { name: 'Heading 2' }).click();
    await expect(editor(page).locator('h2')).toContainText('make me strong');
    await expect(page.getByTestId('block-type-trigger')).toContainText('Heading 2');
  });

  test('keyboard shortcuts: bold, italic, inline code (FR-5.3, §9.3)', async ({ page }) => {
    await newWysiwygDoc(page);
    await page.keyboard.type('shortcut target');
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+b');
    await expect(editor(page).locator('strong')).toHaveText('shortcut target');
    await page.keyboard.press('ControlOrMeta+i');
    await expect(editor(page).locator('em')).toHaveText('shortcut target');
    await page.keyboard.press('ControlOrMeta+e');
    await expect(editor(page).locator('code')).toHaveText('shortcut target');
  });

  test('table insert renders an editable table (FR-5.2, FR-5.7)', async ({ page }) => {
    await newWysiwygDoc(page);
    await page.getByRole('button', { name: 'Insert table' }).click();
    // The NodeView renders the rows into `table.mk-table-grid > tbody`.
    await expect(editor(page).locator('table.mk-table-grid')).toBeVisible();
    expect(await editor(page).locator('table.mk-table-grid tr').count()).toBe(3);
  });

  test('table pills stay out of the document until hovered (FR-5.7)', async ({ page }) => {
    await stubFsa(page);
    await seedFakeFile(page, 'table.md', TABLE_DOC);
    await page.goto('/');
    await page.getByTestId('welcome-open').click();
    await expect(editor(page).locator('table.mk-table-grid')).toBeVisible({ timeout: 15000 });

    // The chrome is an absolutely-positioned overlay: unpositioned it would
    // land in the text flow and push the grid down the frame.
    const offset = await page.evaluate(() => {
      const frame = document.querySelector('.mk-table') as HTMLElement;
      const scroll = frame.querySelector('.mk-table-scroll') as HTMLElement;
      return scroll.getBoundingClientRect().top - frame.getBoundingClientRect().top;
    });
    expect(offset).toBeLessThan(4);

    const colPill = page.locator('.mk-table-pill-col');
    const rowPill = page.locator('.mk-table-pill-row');
    await expect(colPill).toBeHidden();
    await expect(rowPill).toBeHidden();

    // Activation follows the header row and the first column. A header cell
    // raises its column's pill…
    await editor(page).locator('th').first().hover();
    await expect(colPill).toBeVisible();
    // …a first-column cell raises its row's pill…
    await editor(page).locator('td', { hasText: 'frame' }).hover();
    await expect(rowPill).toBeVisible();
    await expect(colPill).toBeHidden();
    // …and a cell in neither raises nothing: those reach the same operations
    // by right-click instead, so the chrome stays quiet mid-table.
    await editor(page).locator('td', { hasText: 'A settings document' }).hover();
    await expect(rowPill).toBeHidden();
    await expect(colPill).toBeHidden();
  });

  test('table column alignment via the column menu (FR-5.7)', async ({ page }) => {
    await stubFsa(page);
    await seedFakeFile(page, 'table.md', TABLE_DOC);
    await page.goto('/');
    await page.getByTestId('welcome-open').click();
    await expect(editor(page).locator('table.mk-table-grid')).toBeVisible({ timeout: 15000 });

    // Alignment is the one column-level format markdown has, so it sits one
    // click deep in the column menu rather than behind a select-then-act.
    await editor(page).locator('th').first().hover();
    await page.locator('.mk-table-pill-col button[aria-label="Column options"]').click();
    const menu = page.locator('.mk-table-menu');
    await expect(menu).toBeVisible();
    await menu.getByRole('menuitemradio', { name: 'Align center' }).click();
    await expect(editor(page).locator('th').first()).toHaveAttribute('style', /center/);

    await page.waitForTimeout(600); // push debounce
    await page.keyboard.press('ControlOrMeta+s');
    await expect(page.getByTestId('status-save')).toContainText('Saved');
    // Centre alignment survives serialization: `| :----: |`.
    expect((await getFakeDisk(page))['table.md']).toMatch(/\|\s*:-+:\s*\|/);
  });

  test('table row deletion via the row menu (FR-5.7)', async ({ page }) => {
    await stubFsa(page);
    await seedFakeFile(page, 'table.md', TABLE_DOC);
    await page.goto('/');
    await page.getByTestId('welcome-open').click();
    await expect(editor(page).locator('table.mk-table-grid')).toBeVisible({ timeout: 15000 });

    await editor(page).locator('td', { hasText: 'frame' }).hover();
    await page.locator('.mk-table-pill-row button[aria-label="Row options"]').click();
    const menu = page.locator('.mk-table-menu');
    await expect(menu).toBeVisible();
    await menu.getByRole('menuitem', { name: 'Delete row' }).click();
    await expect(editor(page).locator('table.mk-table-grid')).not.toContainText('frame');

    await page.waitForTimeout(600); // push debounce
    await page.keyboard.press('ControlOrMeta+s');
    await expect(page.getByTestId('status-save')).toContainText('Saved');
    expect((await getFakeDisk(page))['table.md']).not.toContain('frame');
  });

  test('the insert + names its direction and Alt flips it (FR-5.7)', async ({ page }) => {
    await stubFsa(page);
    await seedFakeFile(page, 'table.md', TABLE_DOC);
    await page.goto('/');
    await page.getByTestId('welcome-open').click();
    await expect(editor(page).locator('table.mk-table-grid')).toBeVisible({ timeout: 15000 });

    // A bare `+` is ambiguous about which side it inserts on, so it says so —
    // and Alt reaches the side a one-directional button cannot (there is no
    // other way to put a column left of the first one).
    await editor(page).locator('th').first().hover();
    await page.locator('.mk-table-pill-col button[aria-label="Insert column"]').hover();
    const tip = page.locator('.mk-table-tip');
    await expect(tip).toContainText('Insert 1 column right');

    await page.keyboard.down('Alt');
    await expect(tip).toContainText('Insert 1 column left');
    await page.locator('.mk-table-pill-col button[aria-label="Insert column"]').click();
    await page.keyboard.up('Alt');

    // The new column landed before "Term", not after it.
    await expect(editor(page).locator('th')).toHaveCount(3);
    await expect(editor(page).locator('th').nth(1)).toHaveText('Term');
  });

  test('dragging the row grip reorders rows (FR-5.7)', async ({ page }) => {
    await stubFsa(page);
    await seedFakeFile(page, 'table.md', TABLE_DOC);
    await page.goto('/');
    await page.getByTestId('welcome-open').click();
    await expect(editor(page).locator('table.mk-table-grid')).toBeVisible({ timeout: 15000 });

    const firstColumn = () => editor(page).locator('tbody tr td:first-child').allTextContents();
    expect(await firstColumn()).toEqual(['slot', 'frame', 'parent']);

    await editor(page).locator('td', { hasText: 'frame' }).hover();
    const grip = page.locator('.mk-table-pill-row button[aria-label="Select or drag row"]');
    await expect(grip).toBeVisible();
    const from = (await grip.boundingBox())!;
    const onto = (await editor(page).locator('td', { hasText: 'parent' }).boundingBox())!;

    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(onto.x + onto.width / 2, onto.y + onto.height / 2, { steps: 10 });
    await page.mouse.up();

    await expect.poll(firstColumn).toEqual(['slot', 'parent', 'frame']);
  });

  test('math input rule renders KaTeX; click opens the source editor (FR-5.8)', async ({
    page,
  }) => {
    await newWysiwygDoc(page);
    await page.keyboard.type('Euler: $e^{i\\pi}+1=0$');

    const math = editor(page).locator('[data-type="math-inline"]');
    await expect(math).toBeVisible();
    await expect(math.locator('.katex')).toBeVisible();

    await math.click();
    const popover = page.getByRole('dialog', { name: 'Edit inline math (LaTeX)' });
    await expect(popover).toBeVisible();
    await popover.locator('textarea').fill('x^2');
    await popover.getByRole('button', { name: 'Apply' }).click();
    await expect(math.locator('.katex')).toContainText('x');
  });

  test('invalid LaTeX shows a graceful error chip (FR-5.8)', async ({ page }) => {
    await newWysiwygDoc(page);
    await page.keyboard.type('$\\frac{$');
    await expect(editor(page).locator('.math-error-chip')).toBeVisible();
  });

  test('blockquote converts to a callout via [!type] (FR-5.10)', async ({ page }) => {
    await newWysiwygDoc(page);
    // "> " wraps in a blockquote; "[!tip] " converts it to a callout.
    await page.keyboard.type('> [!tip] ');
    await page.keyboard.type('use callouts');

    const callout = editor(page).locator('.callout-tip');
    await expect(callout).toBeVisible();
    await expect(callout.locator('.callout-title-text')).toHaveText('Tip');
    await expect(callout).toContainText('use callouts');

    // The type picker switches the callout kind in place.
    await callout.locator('.callout-picker').selectOption('warning');
    await expect(editor(page).locator('.callout-warning')).toBeVisible();
  });

  test('a nested list built by typing saves with no spurious blank line (D13)', async ({
    page,
  }) => {
    await stubFsa(page);
    await seedFakeFile(page, 'typed.md', '');
    await page.goto('/');
    await page.getByTestId('welcome-open').click();
    await expect(editor(page)).toBeVisible({ timeout: 15000 });
    await editor(page).click();

    // Build the list by hand, the way a user does. The round-trip fixtures all
    // load from disk, so only a typed list exercises the schema's attr
    // defaults -- and `list_item.spread` used to default to `true`, which put a
    // blank line between "two" and its nested list and made the whole list
    // loose on reparse.
    await page.keyboard.type('- one');
    await page.keyboard.press('Enter');
    await page.keyboard.type('two');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await page.keyboard.type('nested a');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.type('three');
    await page.waitForTimeout(600); // push debounce

    await page.keyboard.press('ControlOrMeta+s');
    await expect(page.getByTestId('status-save')).toContainText('Saved');

    const disk = await getFakeDisk(page);
    expect(disk['typed.md']).toBe('- one\n- two\n  - nested a\n- three\n');
  });

  test('a tight nested list keeps one even gap; loose items stay airy (FR-4.4)', async ({
    page,
  }) => {
    await stubFsa(page);
    await seedFakeFile(page, 'lists.md', LIST_DOC);
    await page.goto('/');
    await page.getByTestId('welcome-open').click();
    await expect(editor(page).locator('ul').first()).toBeVisible({ timeout: 15000 });

    const gaps = await page.evaluate(() => {
      const round = (v: number) => Math.round(v * 100) / 100;
      const root = document.querySelector('.wysiwyg-root .ProseMirror')!;
      const blocks = [...root.querySelectorAll('.milkdown-list-item-block')];

      const parent = blocks.find((b) => b.querySelector('ul'))!;
      const nested = parent.querySelector('ul')!;
      const parentText = parent.querySelector('.content-dom > p')!;
      const nestedItems = [...nested.children];
      const after = parent.nextElementSibling!;

      const loose = root.querySelector('ul[data-spread="true"]');
      const looseParas = loose ? [...loose.querySelectorAll('.content-dom > p')] : [];

      const gap = (a: Element, b: Element) =>
        round(b.getBoundingClientRect().top - a.getBoundingClientRect().bottom);

      return {
        sibling: gap(blocks[0], blocks[1]),
        intoNested: gap(parentText, nested),
        nestedSibling: gap(nestedItems[0], nestedItems[1]),
        outOfNested: gap(nested, after),
        // A loose item's two paragraphs must keep their own, wider rhythm.
        looseParagraphs: looseParas.length > 1 ? gap(looseParas[0], looseParas[1]) : null,
      };
    });

    // Indenting used to cost 12px where every other gap costs 4px, because
    // `.md-doc p`'s margin survived on the paragraph before the nested list.
    expect(gaps.intoNested).toBe(gaps.sibling);
    expect(gaps.nestedSibling).toBe(gaps.sibling);
    expect(gaps.outOfNested).toBe(gaps.sibling);
    // Scoping the fix to the list boundary leaves loose items alone.
    expect(gaps.looseParagraphs).toBeGreaterThan(gaps.sibling);
  });

  test('callout title sits beside its icon, picker stays right (FR-5.10)', async ({ page }) => {
    await newWysiwygDoc(page);
    await page.keyboard.type('> [!note] ');
    await expect(editor(page).locator('.callout-note')).toBeVisible();

    // The icon is a ::before pseudo-element with no rect of its own, so compare
    // the title against where a flush title would start. `justify-content:
    // space-between` on this three-child row used to strand it ~174px right.
    const layout = await page.evaluate(() => {
      const row = document.querySelector('.wysiwyg-root .callout-title')!;
      const text = row.querySelector('.callout-title-text')!;
      const picker = row.querySelector('.callout-picker')!;
      const cs = getComputedStyle(row);
      const num = (v: string) => (v === 'normal' ? 0 : parseFloat(v));
      const r = row.getBoundingClientRect();
      const flushLeft =
        r.left +
        num(cs.paddingLeft) +
        num(getComputedStyle(row, '::before').width) +
        num(cs.columnGap);
      return {
        titleOffsetPastIcon: text.getBoundingClientRect().left - flushLeft,
        pickerGapToRightEdge: r.right - num(cs.paddingRight) - picker.getBoundingClientRect().right,
      };
    });

    // Sub-pixel tolerance only — anything larger means the title is floating.
    expect(Math.abs(layout.titleOffsetPastIcon)).toBeLessThan(2);
    expect(Math.abs(layout.pickerGapToRightEdge)).toBeLessThan(2);
  });

  test('code block has a language picker with highlighting (FR-5.1)', async ({ page }) => {
    await newWysiwygDoc(page);
    // The fence input rule triggers on trailing whitespace.
    await page.keyboard.type('``` ');

    const codeBlock = editor(page).locator('.milkdown-code-block');
    await expect(codeBlock).toBeVisible();
    await codeBlock.locator('.language-button').click();
    await codeBlock.locator('.search-input').fill('typescript');
    await codeBlock.locator('.language-list-item', { hasText: 'typescript' }).first().click();
    await expect(codeBlock.locator('.language-button')).toContainText(/typescript/i);

    await codeBlock.locator('.cm-content').click();
    await page.keyboard.type('const n: number = 42;');
    await expect(codeBlock.locator('.cm-content')).toContainText('const n: number = 42;');
  });

  test('code block tools buttons look and feel clickable (FR-5.1)', async ({ page }) => {
    await newWysiwygDoc(page);
    await page.keyboard.type('``` ');

    // The vendored component ships no CSS of its own, so a tools-bar button
    // missing from wysiwyg.css still copies but never reacts to the pointer.
    const copy = editor(page).locator('.milkdown-code-block .copy-button');
    await expect(copy).toBeVisible();
    await expect(copy).toHaveCSS('cursor', 'pointer');

    const background = () => copy.evaluate((el) => getComputedStyle(el).backgroundColor);
    const atRest = await background();
    await copy.hover();
    await expect.poll(background).not.toBe(atRest);
  });

  test('a nontrivial README renders with zero syntax leakage (M3 exit)', async ({ page }) => {
    await stubFsa(page);
    await seedFakeFile(page, 'sample.md', README);
    await page.goto('/');
    await page.getByTestId('welcome-open').click();
    await expect(editor(page)).toBeVisible({ timeout: 15000 });

    const doc = editor(page);
    await expect(doc.locator('h1')).toHaveText('MarkYou Sample');
    await expect(doc.locator('strong').first()).toHaveText('bold');
    await expect(doc.locator('table.mk-table-grid')).toBeVisible();
    await expect(doc.locator('.callout-warning')).toContainText('Callouts render as styled boxes.');
    await expect(doc.locator('[data-type="math-inline"] .katex')).toBeVisible();
    await expect(doc.locator('[data-type="math-block"]')).toBeVisible();
    await expect(doc.locator('.milkdown-code-block')).toBeVisible();
    // Raw HTML survives as an inert chip, not rendered markup (FR-5.11).
    await expect(doc.locator('.html-chip-block')).toContainText('raw html block');
    // The unused link definition is preserved as a chip, not dropped.
    await expect(doc.locator('.definition-chip')).toContainText('unused-def');

    // No literal markdown tokens leak into the rendered document.
    const text = (await doc.innerText()).replace(/[\s\u200b]+/g, ' ');
    expect(text).not.toContain('**');
    expect(text).not.toContain('~~');
    expect(text).not.toContain('# MarkYou');
    expect(text).not.toContain('| Col A |');
  });

  test('editing preserves untouched constructs byte-for-byte on save (D13)', async ({ page }) => {
    await stubFsa(page);
    await seedFakeFile(page, 'sample.md', README);
    await page.goto('/');
    await page.getByTestId('welcome-open').click();
    await expect(editor(page)).toBeVisible({ timeout: 15000 });

    // Append a word to the last paragraph.
    await editor(page).locator('p', { hasText: 'The end.' }).click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Edited.');
    await expect(editor(page)).toContainText('The end. Edited.');
    await page.waitForTimeout(600); // push debounce

    await page.keyboard.press('ControlOrMeta+s');
    await expect(page.getByTestId('status-save')).toContainText('Saved');

    const disk = await getFakeDisk(page);
    const saved = disk['sample.md'];
    expect(saved).toContain('The end. Edited.');
    // Untouched constructs survive: html verbatim, definition, math, callout.
    expect(saved).toContain('<div class="custom">raw html block</div>');
    expect(saved).toContain('[unused-def]: https://example.com/kept "Kept definition"');
    expect(saved).toContain('$e^{i\\pi}+1=0$');
    expect(saved).toContain('\\int_0^1 x\\,dx');
    // Callout markers normalize to the canonical uppercase form (D13).
    expect(saved).toContain('[!WARNING] Careful');
    expect(saved).toContain('const x: number = 1;');
    expect(saved).toContain('- [x] shipped');
  });

  test('frontmatter never appears in WYSIWYG (FR-5.12)', async ({ page }) => {
    await stubFsa(page);
    await seedFakeFile(page, 'fm.md', '---\ntitle: Secret Meta\n---\n\n# Visible Body\n');
    await page.goto('/');
    await page.getByTestId('welcome-open').click();
    await expect(editor(page)).toBeVisible({ timeout: 15000 });

    await expect(editor(page).locator('h1')).toHaveText('Visible Body');
    await expect(editor(page)).not.toContainText('Secret Meta');

    // Raw mode still shows it (FR-5.12) — and it survives a WYSIWYG session.
    await page.keyboard.press('ControlOrMeta+Shift+Digit1');
    await expect(page.locator('.cm-content')).toContainText('title: Secret Meta');
  });

  test('undo/redo through the toolbar (FR-5.2)', async ({ page }) => {
    await newWysiwygDoc(page);
    await page.keyboard.type('first line');
    await expect(editor(page)).toContainText('first line');

    await page.getByRole('button', { name: 'Undo (Ctrl+Z)' }).click();
    await expect(editor(page)).not.toContainText('first line');
    await page.getByRole('button', { name: 'Redo (Ctrl+Y)' }).click();
    await expect(editor(page)).toContainText('first line');
  });

  test('mermaid renders as a diagram with click-to-edit source (FR-5.9)', async ({ page }) => {
    await stubFsa(page);
    await seedFakeFile(page, 'diagram.md', '```mermaid\ngraph TD;\n  A-->B;\n```\n');
    await page.goto('/');
    await page.getByTestId('welcome-open').click();
    await expect(editor(page)).toBeVisible({ timeout: 15000 });

    const diagram = editor(page).locator('.diagram-node');
    await expect(diagram).toBeVisible();
    // Mermaid is a lazy chunk; the SVG appears once it loads.
    await expect(diagram.locator('svg')).toBeVisible({ timeout: 20000 });

    // Click opens the full-screen source editor (covered in depth by
    // diagram-editor.spec.ts); here it is a smoke check either side of D13.
    await diagram.click();
    const sourceEditor = page.getByRole('dialog', { name: 'Edit Mermaid diagram' });
    await expect(sourceEditor).toBeVisible();
    await expect(sourceEditor.getByTestId('diagram-source')).toHaveValue(/graph TD/);
    await sourceEditor.getByRole('button', { name: 'Cancel' }).click();
    await expect(sourceEditor).toBeHidden();

    // The fence stays byte-identical through a WYSIWYG session (D13).
    await page.keyboard.press('ControlOrMeta+Shift+Digit1');
    await expect(page.locator('.cm-content')).toContainText('graph TD;');
  });

  test('task list checkbox toggles by click and serializes (FR-5.7)', async ({ page }) => {
    await stubFsa(page);
    await seedFakeFile(page, 'tasks.md', '- [ ] buy milk\n- [x] write tests\n');
    await page.goto('/');
    await page.getByTestId('welcome-open').click();
    await expect(editor(page)).toBeVisible({ timeout: 15000 });

    const items = editor(page).locator('.milkdown-list-item-block');
    await expect(items).toHaveCount(2);
    await items.first().locator('.label-wrapper').click();
    await page.waitForTimeout(600); // push debounce

    await page.keyboard.press('ControlOrMeta+s');
    await expect(page.getByTestId('status-save')).toContainText('Saved');
    const disk = await getFakeDisk(page);
    expect(disk['tasks.md']).toContain('- [x] buy milk');
  });

  test('link popover creates and edits links via Ctrl+K (FR-5.1, FR-5.2)', async ({ page }) => {
    await newWysiwygDoc(page);
    await page.keyboard.type('visit here');
    await page.keyboard.press('ControlOrMeta+a');

    // Ctrl+K opens the link editor for the selection (create mode).
    await page.keyboard.press('ControlOrMeta+k');
    const input = page.locator('.milkdown-link-edit .input-area');
    await expect(input).toBeVisible();
    await input.fill('https://example.com');
    await input.press('Enter');

    const link = editor(page).locator('a[href="https://example.com"]');
    await expect(link).toHaveText('visit here');
    // No syntax leaked — the URL/brackets are not shown as text (FR-5.1).
    await expect(editor(page)).not.toContainText('](');

    // Caret inside the link + Ctrl+K re-opens in edit mode (FR-5.1 edit popover).
    await link.click();
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.locator('.milkdown-link-edit .input-area')).toHaveValue(
      'https://example.com',
    );
  });

  test('copy/paste bridges rich text and markdown (FR-5.13)', async ({ page, browserName }) => {
    // A ClipboardEvent with programmatically-constructed clipboardData is only
    // honored by Chromium; Firefox nulls it out. The Milkdown clipboard plugin
    // is engine-agnostic — only this synthetic driver is Chromium-bound, so we
    // assert the rich↔markdown conversion on the Tier-1 browser.
    test.skip(browserName === 'firefox', 'Firefox ignores synthetic clipboardData');
    await newWysiwygDoc(page);

    // Paste rich HTML (as from Docs/Word/web) → markdown-backed content.
    await editor(page).evaluate((el) => {
      const dt = new DataTransfer();
      dt.setData(
        'text/html',
        '<p>Rich <strong>bold</strong> and <em>italic</em> and <a href="https://example.com">link</a>.</p>',
      );
      dt.setData('text/plain', 'Rich bold and italic and link.');
      el.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
      );
    });

    await expect(editor(page).locator('strong')).toHaveText('bold');
    await expect(editor(page).locator('em')).toHaveText('italic');
    await expect(editor(page).locator('a[href="https://example.com"]')).toHaveText('link');
    await page.waitForTimeout(400); // WYSIWYG → store push debounce

    // Switching to raw proves the paste produced markdown, not raw HTML (FR-5.13).
    await page.keyboard.press('ControlOrMeta+Shift+Digit1');
    const raw = page.locator('.cm-content');
    await expect(raw).toContainText('**bold**');
    await expect(raw).toContainText('*italic*');
    await expect(raw).toContainText('[link](https://example.com)');

    // Copying out offers both a markdown (text/plain) and a rich (text/html) flavor.
    await page.keyboard.press('ControlOrMeta+Shift+Digit2'); // back to WYSIWYG
    await expect(editor(page).locator('strong')).toHaveText('bold');
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+a');
    const flavors = await editor(page).evaluate((el) => {
      const dt = new DataTransfer();
      el.dispatchEvent(
        new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }),
      );
      return { text: dt.getData('text/plain'), html: dt.getData('text/html') };
    });
    expect(flavors.text).toContain('**bold**');
    expect(flavors.html).toContain('<strong>');
  });
});
