import { Plugin } from '@milkdown/kit/prose/state';
import { isInTable, selectionCell } from '@milkdown/kit/prose/tables';
import { $nodeSchema, $prose } from '@milkdown/kit/utils';

/**
 * A line break inside a GFM table cell (FR-5.7).
 *
 * A pipe-table row *is* one line of source text, so a cell cannot hold a
 * newline. `<br>` is the only portable encoding, and it is what Docs, GitHub,
 * Obsidian and Typora all write.
 *
 * The commonmark `hardbreak` cannot serve. It serializes to a backslash break,
 * which is illegal in a cell, so `mdast-util-gfm-table` — which marks `\n`
 * unsafe inside `tableCell` — silently rewrites it to a space. A break pasted
 * into a cell used to disappear on save with no warning; that is content loss,
 * not a formatting quirk.
 *
 * `raw` keeps the exact spelling the document used (`<br>`, `<br/>`,
 * `<br />`), so a round trip never rewrites HTML the author typed. The corpus
 * gate holds html values to byte equality and this node has to clear it.
 *
 * The node is only ever *created* inside cells — the keymap binds it there and
 * `remarkTableBreaks` re-tags nothing else. `group: inline` leaves it
 * representable elsewhere, which costs nothing and keeps the schema simple.
 */
export const tableBreakSchema = $nodeSchema('table_break', () => ({
  inline: true,
  group: 'inline',
  selectable: false,
  attrs: {
    raw: { default: '<br>', validate: 'string' },
  },
  /** Copying a multi-line cell should yield the newline it looks like. */
  leafText: () => '\n',
  parseDOM: [
    {
      tag: 'br[data-type="table-break"]',
      // Outranks the commonmark hardbreak's bare `br` rule, so our own copied
      // HTML comes back as itself rather than as a hardbreak.
      priority: 60,
      getAttrs: (dom) => ({ raw: (dom as HTMLElement).dataset.raw ?? '<br>' }),
    },
  ],
  toDOM: (node) => ['br', { 'data-type': 'table-break', 'data-raw': node.attrs.raw as string }],
  parseMarkdown: {
    match: (node) => node.type === 'tableBreak',
    runner: (state, node, type) => {
      state.addNode(type, { raw: node.value as string });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'table_break',
    runner: (state, node) => {
      state.addNode('html', undefined, node.attrs.raw as string);
    },
  },
}));

/**
 * Rewrite any `hardbreak` that lands inside a table cell into a `table_break`.
 *
 * Nothing in the editor's own bindings produces one there, but paste does:
 * rich HTML from Docs or a browser carries `<br>`, which the commonmark
 * hardbreak rule claims. Left alone it survives on screen and then vanishes
 * into a space on save. Converting on arrival keeps the break the user can
 * see and the break the file records as the same thing.
 *
 * Scoped to the table holding the selection — a paste can only land in one —
 * so the common case (typing outside a table) costs a single `isInTable`.
 */
export const tableBreakNormalizer = $prose((ctx) => {
  return new Plugin({
    appendTransaction: (trs, _oldState, state) => {
      if (!trs.some((tr) => tr.docChanged)) return null;
      if (!isInTable(state)) return null;

      const hardbreak = state.schema.nodes.hardbreak;
      if (!hardbreak) return null;

      // `selectionCell` resolves *before* the cell, i.e. inside the row, so
      // the table sits one level up.
      const $cell = selectionCell(state);
      const table = $cell.node(-1);
      const start = $cell.start(-1);
      const type = tableBreakSchema.type(ctx);

      let tr = null;
      table.descendants((node, pos) => {
        if (node.type !== hardbreak) return;
        // Both are one-token inline leaves, so replacing in place leaves every
        // later position untouched and the walk stays valid.
        tr ??= state.tr;
        tr.replaceWith(start + pos, start + pos + node.nodeSize, type.create());
      });
      return tr;
    },
  });
});

export const tableBreakNodes = [tableBreakSchema, tableBreakNormalizer].flat();
