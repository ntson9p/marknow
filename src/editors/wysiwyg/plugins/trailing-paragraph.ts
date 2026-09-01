import { paragraphSchema } from '@milkdown/kit/preset/commonmark';
import { keymap } from '@milkdown/kit/prose/keymap';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import {
  Plugin,
  PluginKey,
  Selection,
  type Command,
  type EditorState,
  type Transaction,
} from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';

/**
 * Blocks that can't take the caret from a click or an arrow key below them:
 * atoms (math blocks, diagrams, rules, html chips) and the two whose editing
 * surface belongs to a NodeView rather than to ProseMirror. Prose containers —
 * paragraphs, headings, quotes, callouts, lists — are their own way out and are
 * deliberately left alone.
 */
const NODE_VIEW_BLOCKS = new Set(['code_block', 'table']);

export function needsTrailingParagraph(last: ProseNode): boolean {
  return last.isAtom || NODE_VIEW_BLOCKS.has(last.type.name);
}

/**
 * Keep an empty paragraph below a document that ends in a block the caret
 * cannot leave (FR-5.6), the way Docs and Word both do.
 *
 * A table at the end of a document had three exits and two were silently
 * broken: the gap cursor `ArrowDown` produces was never styled, so it drew
 * nothing and read as a dead key, and `trailingClickPlugin` needs gutter to be
 * clicked in — of which there is 6px on a short document and none at all once
 * the content passes the editor's `min-height`. That left Mod-Enter, which
 * nothing on screen mentions. A line that is simply *there* needs no discovery
 * at all, which is the whole argument for this.
 *
 * It costs the file nothing. An empty trailing paragraph serializes to exactly
 * one extra newline, and `normalizeSerialized` drops it — without that the
 * paragraph would count as an edit and mark every table-ending document dirty
 * the moment it opened.
 *
 * `trailingBackspaceKeymap` below is not optional: without it this plugin
 * hands the user a one-keystroke way to lose a table.
 */
export const trailingParagraph = $prose((ctx) => {
  const ensure = (state: EditorState): Transaction | null => {
    const last = state.doc.lastChild;
    if (!last || !needsTrailingParagraph(last)) return null;
    const end = state.doc.content.size;
    return (
      state.tr
        .insert(end, paragraphSchema.type(ctx).create())
        // Chrome, not an edit: undo steps over the user's last real change.
        .setMeta('addToHistory', false)
    );
  };

  return new Plugin({
    key: new PluginKey('trailingParagraph'),
    // Re-running on the transaction this appends is harmless — the last child
    // is a paragraph by then, so the second pass returns null.
    appendTransaction: (trs, _oldState, state) =>
      trs.some((tr) => tr.docChanged) ? ensure(state) : null,
    view: (view) => {
      // The first document arrives with the editor rather than through a
      // transaction, so it needs its own pass — deferred, because dispatching
      // inside a plugin view's constructor re-enters the update it is part of.
      let alive = true;
      void Promise.resolve().then(() => {
        if (!alive) return;
        const tr = ensure(view.state);
        if (tr) view.dispatch(tr);
      });
      return {
        destroy: () => {
          alive = false;
        },
      };
    },
  });
});

/**
 * Backspace in the kept paragraph steps back into the block above rather than
 * selecting it.
 *
 * ProseMirror's default is to select the whole node behind the caret, so the
 * *next* keystroke replaces it. That is reasonable when the user deliberately
 * put the caret below a table; it is not reasonable for a paragraph they never
 * asked for, where "delete this line I didn't want" would silently take the
 * table with it. Docs resolves the same tension the same way — Backspace there
 * puts the cursor in the last cell.
 *
 * Only the empty, last, plugin-kept paragraph is claimed. A paragraph with
 * text in it, or one the document genuinely ends with, keeps the default.
 */
const stepBackIntoBlock: Command = (state, dispatch) => {
  const { selection, doc } = state;
  if (!selection.empty) return false;

  const { $head } = selection;
  if ($head.depth !== 1 || $head.parent.type.name !== 'paragraph') return false;
  if ($head.parent.content.size > 0) return false;
  if ($head.index(0) !== doc.childCount - 1 || doc.childCount < 2) return false;
  if (!needsTrailingParagraph(doc.child(doc.childCount - 2))) return false;

  if (dispatch) {
    // Resolving just before the paragraph and searching backwards lands inside
    // the block — the last cell of a table, the text of a code block — instead
    // of on it.
    const selectionBefore = Selection.near(doc.resolve($head.before()), -1);
    dispatch(state.tr.setSelection(selectionBefore).scrollIntoView());
  }
  return true;
};

/** Registered ahead of the presets so it wins the default `joinBackward`. */
export const trailingBackspaceKeymap = $prose(() => keymap({ Backspace: stepBackIntoBlock }));
