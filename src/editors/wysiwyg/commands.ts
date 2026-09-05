import { commandsCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import {
  bulletListSchema,
  codeBlockSchema,
  inlineCodeSchema,
  toggleInlineCodeCommand,
} from '@milkdown/kit/preset/commonmark';
import { wrapIn } from '@milkdown/kit/prose/commands';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { NodeSelection, TextSelection } from '@milkdown/kit/prose/state';
import type { EditorState, Transaction } from '@milkdown/kit/prose/state';
import { $command } from '@milkdown/kit/utils';

import { CALLOUT_TYPES, type CalloutType } from '@/core/markdown/callouts';

import { calloutSchema } from './nodes/callout';
import { diagramSchema } from './nodes/diagram';
import { mathBlockSchema, mathInlineSchema } from './nodes/math';

/** Insert `$…$` inline math at the selection (FR-5.8). */
export const insertMathInlineCommand = $command(
  'InsertMathInline',
  (ctx) =>
    (value = '') =>
    (state, dispatch) => {
      const type = mathInlineSchema.type(ctx);
      const node = type.create({ value });
      if (dispatch) {
        const tr = state.tr.replaceSelectionWith(node);
        const pos = tr.selection.from - node.nodeSize;
        dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos)).scrollIntoView());
      }
      return true;
    },
);

/** Insert a `$$…$$` math block at the selection (FR-5.8). */
export const insertMathBlockCommand = $command(
  'InsertMathBlock',
  (ctx) =>
    (value = '') =>
    (state, dispatch) => {
      const type = mathBlockSchema.type(ctx);
      if (dispatch) {
        const tr = state.tr.replaceSelectionWith(type.create({ value }));
        dispatch(tr.scrollIntoView());
      }
      return true;
    },
);

/** Insert a mermaid diagram block (FR-5.9). */
export const insertDiagramCommand = $command(
  'InsertDiagram',
  (ctx) =>
    (value = 'graph TD\n  A[Start] --> B[End]') =>
    (state, dispatch) => {
      const type = diagramSchema.type(ctx);
      if (dispatch) {
        dispatch(state.tr.replaceSelectionWith(type.create({ value })).scrollIntoView());
      }
      return true;
    },
);

/**
 * Wrap the selection in a callout, or retype the enclosing callout when
 * already inside one (FR-5.10).
 */
export const wrapInCalloutCommand = $command(
  'WrapInCallout',
  (ctx) =>
    (calloutType: CalloutType = CALLOUT_TYPES[0]) =>
    (state, dispatch) => {
      const type = calloutSchema.type(ctx);
      const { $from } = state.selection;
      for (let depth = $from.depth; depth > 0; depth--) {
        const node = $from.node(depth);
        if (node.type === type) {
          dispatch?.(
            state.tr.setNodeMarkup($from.before(depth), undefined, { ...node.attrs, calloutType }),
          );
          return true;
        }
      }
      return wrapIn(type, { calloutType })(state, dispatch);
    },
);

/**
 * Toggle task-list state (FR-5.2): items in the selection become tasks
 * (checked=false); if all are already tasks, they revert to plain items.
 * Outside a list, wraps in a bullet list first.
 */
export const toggleTaskListCommand = $command(
  'ToggleTaskList',
  (ctx) => () => (state, dispatch, view) => {
    const collectItems = (doc: ProseNode, from: number, to: number) => {
      const items: { pos: number; node: ProseNode }[] = [];
      doc.nodesBetween(from, to, (node, pos) => {
        if (node.type.name === 'list_item') items.push({ pos, node });
      });
      return items;
    };

    const { from, to } = state.selection;
    let items = collectItems(state.doc, from, to);

    if (items.length === 0) {
      // Wrap in a bullet list first, then mark the fresh items as tasks.
      const wrapped = wrapIn(bulletListSchema.type(ctx))(state, dispatch);
      if (!wrapped || !dispatch || !view) return wrapped;
      const next = view.state;
      items = collectItems(next.doc, next.selection.from, next.selection.to);
      if (items.length === 0) return true;
      let tr = next.tr;
      for (const { pos, node } of items) {
        tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: false });
      }
      dispatch(tr);
      return true;
    }

    const makeTasks = items.some(({ node }) => node.attrs.checked == null);
    if (dispatch) {
      let tr = state.tr;
      for (const { pos, node } of items) {
        tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: makeTasks ? false : null });
      }
      dispatch(tr);
    }
    return true;
  },
);

/**
 * True for a textblock holding nothing but whitespace. Content that merely
 * has no *text* — a paragraph carrying only an image — is not blank; replacing
 * it with a code block would silently delete the image.
 */
function isBlankTextblock(node: ProseNode): boolean {
  if (!node.isTextblock) return false;
  if (node.content.size === 0) return true;
  let blank = true;
  node.forEach((child) => {
    if (!child.isText || (child.text ?? '').trim() !== '') blank = false;
  });
  return blank;
}

/**
 * Replace the caret's blank textblock with an empty code block and park the
 * caret on its one blank line — the code-block NodeView focuses its own
 * CodeMirror when the selection lands inside it.
 *
 * Returns false wherever a code block cannot go (a table cell holds inline
 * content only), leaving the caller to fall back to inline code.
 */
function createEmptyCodeBlock(
  ctx: Ctx,
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
): boolean {
  const { $from } = state.selection;
  const depth = $from.depth;
  if (depth === 0) return false;

  const type = codeBlockSchema.type(ctx);
  const index = $from.index(depth - 1);
  if (!$from.node(depth - 1).canReplaceWith(index, index + 1, type)) return false;

  if (dispatch) {
    const from = $from.before(depth);
    const tr = state.tr.replaceWith(from, $from.after(depth), type.create());
    // `from + 1` is inside the new block's (empty) content.
    dispatch(tr.setSelection(TextSelection.create(tr.doc, from + 1)).scrollIntoView());
  }
  return true;
}

/**
 * The toolbar's code action (FR-5.2), covering the case upstream declines:
 * `toggleInlineCodeCommand` opens with `if (selection.empty) return false`, so
 * with a bare caret the button — and Ctrl+E — did nothing at all.
 *
 * With a selection upstream still owns the toggle. With a bare caret the line
 * decides: an empty one becomes a fenced block with the caret inside it, and
 * anywhere else the inline-code mark is armed for the next character typed.
 * A mark cannot span an empty range, so arming is the only honest way to say
 * "code starts here" without writing placeholder text into the user's file;
 * `inlineCodeCaretPlugin` draws the chip that makes it visible.
 */
export const insertCodeCommand = $command('InsertCode', (ctx) => () => (state, dispatch, view) => {
  const { selection } = state;

  // A selection is upstream's business — it also strips competing marks.
  if (!selection.empty) {
    return ctx.get(commandsCtx).get(toggleInlineCodeCommand.key)()(state, dispatch, view);
  }

  const { $from } = selection;
  // Inside a code block the caret lives in CodeMirror, not in this document.
  if ($from.parent.type.spec.code) return false;

  if (isBlankTextblock($from.parent) && createEmptyCodeBlock(ctx, state, dispatch)) return true;

  const inlineCode = inlineCodeSchema.type(ctx);
  if (dispatch) {
    // Toggle semantics survive: armed or inherited, a second press disarms.
    const active = inlineCode.isInSet(state.storedMarks ?? $from.marks());
    dispatch(
      active ? state.tr.removeStoredMark(inlineCode) : state.tr.addStoredMark(inlineCode.create()),
    );
  }
  return true;
});

export const wysiwygCommands = [
  insertMathInlineCommand,
  insertMathBlockCommand,
  insertDiagramCommand,
  wrapInCalloutCommand,
  toggleTaskListCommand,
  insertCodeCommand,
];
