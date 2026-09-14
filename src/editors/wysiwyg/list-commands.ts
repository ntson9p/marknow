import { editorViewCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import {
  bulletListSchema,
  listItemSchema,
  orderedListSchema,
} from '@milkdown/kit/preset/commonmark';
import type { Attrs, Node as ProseNode, NodeType } from '@milkdown/kit/prose/model';
import { liftListItem, wrapRangeInList } from '@milkdown/kit/prose/schema-list';
import { AllSelection, TextSelection } from '@milkdown/kit/prose/state';
import type { EditorState, Transaction } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $command } from '@milkdown/kit/utils';

/**
 * One list action behind the three list buttons (FR-5.2), replacing the
 * wrap-only `wrapInBulletList` / `wrapInOrderedList` and the attribute-only
 * task toggle.
 *
 * Each of those could only ever *add* something: ProseMirror's `wrapIn` asks
 * the schema for a legal wrapping, and inside a `list_item` — whose content is
 * `paragraph block*`, the leading paragraph required — there is none. So a
 * second press did nothing, and no button could retype a list that already
 * existed. This is a setter instead: it puts the selected items into the kind
 * asked for, or lifts them out of the list when they already are it.
 *
 * Three facts about the schema shape every branch below:
 *
 * 1. A task list is not a node type — it is a `bullet_list` whose items carry
 *    `checked` (gfm's `extendListItemSchemaForTask`). Two of the three kinds
 *    therefore share a node type and differ only by an item attribute.
 * 2. The marker is drawn from the *item's* `listType` / `label` / `checked`
 *    attrs, never from the list holding it — retyping the list node alone
 *    leaves bullets down the side of a numbered list.
 * 3. Upstream's `syncListOrderPlugin` promotes a `bullet_list` back to an
 *    `ordered_list` whenever its first item still says `listType: 'ordered'`,
 *    and does it with a *string* `spread` that turns every tight list loose —
 *    the bug `list-spread-fix.ts` exists to avoid. So the node type and the
 *    item attrs have to move together, in one transaction, or a conversion
 *    either bounces straight back or quietly reformats the file.
 */

/** The three shapes the toolbar, the shortcuts and the slash menu can ask for. */
export type ListKind = 'bullet' | 'ordered' | 'task';

const BULLET_LABEL = '•';

function listTypeFor(ctx: Ctx, kind: ListKind): NodeType {
  return kind === 'ordered' ? orderedListSchema.type(ctx) : bulletListSchema.type(ctx);
}

/** List attrs for a list of `kind`, carrying `spread` over so tight stays tight. */
function listAttrsFor(kind: ListKind, from: Attrs): Attrs {
  return kind === 'ordered' ? { spread: from.spread, order: 1 } : { spread: from.spread };
}

/**
 * Item attrs for `kind`. `ordinal` is the number the item would show in an
 * ordered list, and is ignored by the bullet-shaped kinds. Written out here
 * rather than left to `syncListOrderPlugin`, which skips any transaction
 * carrying meta — `scrollIntoView()` alone is enough to make it look away.
 */
function itemAttrsFor(kind: ListKind, from: Attrs, ordinal: number): Attrs {
  const checked = from.checked as boolean | null | undefined;
  return {
    ...from,
    checked: kind === 'task' ? (checked ?? false) : null,
    listType: kind === 'ordered' ? 'ordered' : 'bullet',
    label: kind === 'ordered' ? `${ordinal}.` : BULLET_LABEL,
  };
}

/** What the selected items already are. Mixed task-ness counts as not-task. */
function kindOf(list: ProseNode, items: ProseNode[], ordered: NodeType): ListKind {
  if (list.type === ordered) return 'ordered';
  return items.every((item) => item.attrs.checked != null) ? 'task' : 'bullet';
}

/** Rebuild `items` as members of a list of `kind`, numbered from `base`. */
function retype(items: ProseNode[], kind: ListKind, base: number): ProseNode[] {
  return items.map((item, i) =>
    item.type.create(itemAttrsFor(kind, item.attrs, base + i), item.content, item.marks),
  );
}

/** A list of these items — the same test `liftListItem` uses to find its range. */
const isListOf = (itemType: NodeType) => (node: ProseNode) =>
  node.childCount > 0 && node.firstChild?.type === itemType;

/**
 * The list items the selection covers, and the list holding them — the very
 * range `liftListItem` works on, so "off" lands on exactly what "on" hit.
 */
function itemRange(state: EditorState, itemType: NodeType) {
  const { $from, $to } = state.selection;
  return $from.blockRange($to, isListOf(itemType));
}

/**
 * Nothing is a list yet: wrap the selected blocks — one item per block, which
 * plain `wrapIn` never did (it made a single item holding every paragraph) —
 * then stamp the new items so they draw the right marker.
 */
function wrapInKind(
  ctx: Ctx,
  kind: ListKind,
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
): boolean {
  const { $from, $to } = state.selection;
  const range = $from.blockRange($to);
  if (!range) return false;

  const tr = dispatch ? state.tr : null;
  if (!wrapRangeInList(tr, range, listTypeFor(ctx, kind), listAttrsFor(kind, {}))) return false;
  if (!tr || !dispatch) return true;

  const itemType = listItemSchema.type(ctx);
  const from = tr.mapping.map(range.start, -1);
  const to = tr.mapping.map(range.end, 1);
  const found: { pos: number; ordinal: number }[] = [];
  tr.doc.nodesBetween(from, to, (node, pos, parent, index) => {
    if (node.type !== itemType) return true;
    found.push({ pos, ordinal: index + ((parent?.attrs.order as number | undefined) ?? 1) });
    // Anything nested inside this item belongs to its own list — leave it be.
    return false;
  });
  for (const { pos, ordinal } of found) {
    const item = tr.doc.nodeAt(pos);
    if (item) tr.setNodeMarkup(pos, undefined, itemAttrsFor(kind, item.attrs, ordinal));
  }
  dispatch(tr.scrollIntoView());
  return true;
}

function applySetList(
  ctx: Ctx,
  kind: ListKind,
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
): boolean {
  const itemType = listItemSchema.type(ctx);
  const ordered = orderedListSchema.type(ctx);
  const targetType = listTypeFor(ctx, kind);

  const range = itemRange(state, itemType);
  if (!range) return wrapInKind(ctx, kind, state, dispatch);

  const list = range.parent;
  const items: ProseNode[] = [];
  for (let i = range.startIndex; i < range.endIndex; i++) items.push(list.child(i));

  // Already exactly this kind: the click means "get me out of the list".
  if (kindOf(list, items, ordered) === kind) return liftListItem(itemType)(state, dispatch);
  if (!dispatch) return true;

  const listPos = range.$from.before(range.depth);
  const wholeList = range.startIndex === 0 && range.endIndex === list.childCount;
  const tr = state.tr;

  // The list itself can stay: either it is already the right node type
  // (bullet and task share one) or every item in it is changing.
  if (list.type === targetType || wholeList) {
    if (list.type !== targetType) {
      tr.setNodeMarkup(listPos, targetType, listAttrsFor(kind, list.attrs));
    }
    const base = (listAttrsFor(kind, list.attrs).order as number | undefined) ?? 1;
    list.forEach((item, offset, index) => {
      if (index < range.startIndex || index >= range.endIndex) return;
      tr.setNodeMarkup(
        listPos + 1 + offset,
        undefined,
        itemAttrsFor(kind, item.attrs, base + index),
      );
    });
    dispatch(tr.scrollIntoView());
    return true;
  }

  // Part of a list, changing node type: markdown cannot say "these three
  // items are numbered and the rest are not" inside one list, so the list
  // splits in three — the same three lists the source pane would write.
  const children: ProseNode[] = [];
  list.forEach((child) => children.push(child));
  const head = children.slice(0, range.startIndex);
  const middle = children.slice(range.startIndex, range.endIndex);
  const tail = children.slice(range.endIndex);
  const oldKind: ListKind = list.type === ordered ? 'ordered' : 'bullet';

  const parts: ProseNode[] = [];
  if (head.length) parts.push(list.type.create(list.attrs, head));
  parts.push(targetType.create(listAttrsFor(kind, list.attrs), retype(middle, kind, 1)));
  // The tail becomes a new list of the old kind, so ordered restarts at 1.
  if (tail.length) {
    parts.push(list.type.create(listAttrsFor(oldKind, list.attrs), retype(tail, oldKind, 1)));
  }
  tr.replaceWith(listPos, listPos + list.nodeSize, parts);

  // Only two positions open ahead of the selection — the boundary closing
  // the head list and the one opening the list the selection moved into.
  const shift = head.length ? 2 : 0;
  const { from, to } = state.selection;
  dispatch(
    tr
      .setSelection(TextSelection.between(tr.doc.resolve(from + shift), tr.doc.resolve(to + shift)))
      .scrollIntoView(),
  );
  return true;
}

/**
 * Select-all gives an `AllSelection`, which resolves at the document root and
 * so carries no block range at all: `applySetList` finds neither a list to
 * convert nor a wrappable run of blocks, and the three buttons look dead.
 *
 * Narrowing it to the text it covers hands the ordinary path something it can
 * work with — but only when that text sits inside one list, which is the whole
 * of the gap. Any other document keeps the selection it had, so it takes the
 * exact same path it always did: this can turn "nothing happened" into a
 * conversion, and can do nothing else. Without that condition it would also
 * start editing documents it used to decline — select-all on a page holding
 * one thematic break would grow an empty bullet on the trailing paragraph.
 */
function narrowToList(ctx: Ctx, state: EditorState): TextSelection | null {
  const { doc } = state;
  const selection = TextSelection.between(doc.resolve(0), doc.resolve(doc.content.size));
  if (!(selection instanceof TextSelection)) return null;
  const range = selection.$from.blockRange(selection.$to, isListOf(listItemSchema.type(ctx)));
  return range ? selection : null;
}

export const setListCommand = $command(
  'SetList',
  (ctx) =>
    (kind: ListKind = 'bullet') =>
    (state, dispatch, view) => {
      const narrowed = state.selection instanceof AllSelection ? narrowToList(ctx, state) : null;
      if (!narrowed) return applySetList(ctx, kind, state, dispatch);
      if (!dispatch) return true;

      // Narrowing is dispatched on its own rather than folded into the work,
      // because the lift branch hands off to `liftListItem`, which reads the
      // selection out of the state it is given. It costs nothing: a
      // transaction with no steps is never an undo entry (prosemirror-history
      // returns early on `steps.length == 0`), so this is still one Ctrl+Z.
      // Going through the view — rather than `state.apply` — also means the
      // work runs on the state the editor actually holds, plugin
      // appendTransactions included.
      const editorView: EditorView = view ?? ctx.get(editorViewCtx);
      editorView.dispatch(state.tr.setSelection(narrowed));
      return applySetList(ctx, kind, editorView.state, dispatch);
    },
);
