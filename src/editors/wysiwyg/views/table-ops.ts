import { commandsCtx } from '@milkdown/kit/core';
import type { CmdKey } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import {
  addColAfterCommand,
  addColBeforeCommand,
  addRowAfterCommand,
  addRowBeforeCommand,
  deleteSelectedCellsCommand,
  moveColCommand,
  moveRowCommand,
  selectColCommand,
  selectRowCommand,
  selectTableCommand,
  setAlignCommand,
} from '@milkdown/kit/preset/gfm';
import type { Node } from '@milkdown/kit/prose/model';
import { TextSelection } from '@milkdown/kit/prose/state';
import { TableMap } from '@milkdown/kit/prose/tables';
import type { EditorView } from '@milkdown/kit/prose/view';

/**
 * Every table mutation the chrome and the context menu can perform (FR-5.7),
 * expressed against a table's document position rather than the current
 * selection — the pointer can be over a table the caret is nowhere near.
 *
 * The gfm preset's table commands all read `selectedRect(state)`, so each
 * operation is "select the row/column, then act on the selection". That is two
 * dispatches; `prosemirror-history` groups transactions that land in the same
 * tick, so it still reads as one undo step.
 *
 * A GFM table is not a free grid: the header row is mandatory, unique and
 * first. Callers get the guards for free — `insertRow` clamps away from row 0,
 * `deleteRow` refuses it, and `canDeleteRow`/`canDuplicateRow` say so up front
 * so a menu can disable the item instead of failing silently.
 */

export type Alignment = 'left' | 'center' | 'right';

/** A table resolved from its document position, with its geometry. */
export interface TableGrid {
  node: Node;
  /** Position of the table node itself (what `getPos()` returns). */
  pos: number;
  /** Position of the table's first child — what the gfm commands want. */
  start: number;
  map: TableMap;
  rows: number;
  cols: number;
}

export function resolveGrid(view: EditorView, tablePos: number): TableGrid | null {
  if (tablePos < 0 || tablePos > view.state.doc.content.size) return null;
  const node = view.state.doc.nodeAt(tablePos);
  if (!node || node.type.name !== 'table') return null;
  const map = TableMap.get(node);
  return { node, pos: tablePos, start: tablePos + 1, map, rows: map.height, cols: map.width };
}

/** Document position of the cell at `[row, col]`, or `null` when out of range. */
export function cellPos(grid: TableGrid, row: number, col: number): number | null {
  if (row < 0 || col < 0 || row >= grid.rows || col >= grid.cols) return null;
  const offset = grid.map.map[row * grid.cols + col];
  return offset === undefined ? null : grid.start + offset;
}

/** Put the caret inside a cell so the user can type straight after an insert. */
export function focusCell(view: EditorView, tablePos: number, row: number, col: number) {
  const grid = resolveGrid(view, tablePos);
  if (!grid) return;
  const pos = cellPos(grid, Math.min(row, grid.rows - 1), Math.min(col, grid.cols - 1));
  if (pos === null) return;
  const selection = TextSelection.near(view.state.doc.resolve(pos + 1), 1);
  view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
  view.focus();
}

function call<T>(ctx: Ctx, key: CmdKey<T>, payload?: T) {
  ctx.get(commandsCtx).call(key, payload);
}

/**
 * Anchor the selection on a row/column so the gfm commands, which all work off
 * `selectedRect`, act on the one the pointer is over.
 */
function anchorRow(ctx: Ctx, grid: TableGrid, index: number) {
  call(ctx, selectRowCommand.key, { pos: grid.start, index });
}

function anchorCol(ctx: Ctx, grid: TableGrid, index: number) {
  call(ctx, selectColCommand.key, { pos: grid.start, index });
}

/* ---------- selection ---------- */

export function selectColumn(ctx: Ctx, view: EditorView, tablePos: number, col: number) {
  const grid = resolveGrid(view, tablePos);
  if (!grid) return;
  anchorCol(ctx, grid, col);
}

export function selectRow(ctx: Ctx, view: EditorView, tablePos: number, row: number) {
  const grid = resolveGrid(view, tablePos);
  if (!grid) return;
  anchorRow(ctx, grid, row);
}

export function selectWholeTable(ctx: Ctx, view: EditorView, tablePos: number) {
  const grid = resolveGrid(view, tablePos);
  if (!grid) return;
  // `selectTableCommand` reads the *current* selection to find its table, so
  // it needs the caret parked inside this one first.
  anchorRow(ctx, grid, 0);
  call(ctx, selectTableCommand.key);
}

/* ---------- insert ---------- */

/**
 * Insert a column so it becomes index `at`. `at === cols` appends at the end.
 */
export function insertColumn(ctx: Ctx, view: EditorView, tablePos: number, at: number) {
  const grid = resolveGrid(view, tablePos);
  if (!grid) return;
  const index = Math.max(0, Math.min(at, grid.cols));
  if (index >= grid.cols) {
    anchorCol(ctx, grid, grid.cols - 1);
    call(ctx, addColAfterCommand.key);
  } else {
    anchorCol(ctx, grid, index);
    call(ctx, addColBeforeCommand.key);
  }
  focusCell(view, tablePos, 0, index);
}

/**
 * Insert a row so it becomes index `at`. Never row 0 — the header row is
 * mandatory and unique, so "insert above the header" means "below it".
 */
export function insertRow(ctx: Ctx, view: EditorView, tablePos: number, at: number) {
  const grid = resolveGrid(view, tablePos);
  if (!grid) return;
  const index = Math.max(1, Math.min(at, grid.rows));
  if (index >= grid.rows) {
    anchorRow(ctx, grid, grid.rows - 1);
    call(ctx, addRowAfterCommand.key);
  } else {
    anchorRow(ctx, grid, index);
    call(ctx, addRowBeforeCommand.key);
  }
  focusCell(view, tablePos, index, 0);
}

/* ---------- delete ---------- */

export function canDeleteColumn(grid: TableGrid) {
  return grid.cols > 1;
}

export function canDeleteRow(grid: TableGrid, row: number) {
  // The header row cannot go, and `table_row+` needs at least one body row.
  return row > 0 && grid.rows > 2;
}

export function deleteColumn(ctx: Ctx, view: EditorView, tablePos: number, col: number) {
  const grid = resolveGrid(view, tablePos);
  if (!grid) return;
  if (!canDeleteColumn(grid)) {
    deleteTable(ctx, view, tablePos);
    return;
  }
  anchorCol(ctx, grid, col);
  call(ctx, deleteSelectedCellsCommand.key);
}

export function deleteRow(ctx: Ctx, view: EditorView, tablePos: number, row: number) {
  const grid = resolveGrid(view, tablePos);
  if (!grid || !canDeleteRow(grid, row)) return;
  anchorRow(ctx, grid, row);
  call(ctx, deleteSelectedCellsCommand.key);
}

export function deleteTable(ctx: Ctx, view: EditorView, tablePos: number) {
  selectWholeTable(ctx, view, tablePos);
  // A full-table CellSelection routes `deleteSelectedCells` to `deleteTable`,
  // which knows how to leave a valid document behind.
  call(ctx, deleteSelectedCellsCommand.key);
  view.focus();
}

/* ---------- move ---------- */

export function moveColumn(ctx: Ctx, view: EditorView, tablePos: number, from: number, to: number) {
  const grid = resolveGrid(view, tablePos);
  if (!grid || to < 0 || to >= grid.cols || from === to) return;
  call(ctx, moveColCommand.key, { from, to, pos: grid.start });
}

export function moveRow(ctx: Ctx, view: EditorView, tablePos: number, from: number, to: number) {
  const grid = resolveGrid(view, tablePos);
  // Row 0 is the header: it neither moves nor gets moved onto.
  if (!grid || from < 1 || to < 1 || to >= grid.rows || from === to) return;
  call(ctx, moveRowCommand.key, { from, to, pos: grid.start });
}

/* ---------- duplicate ---------- */

/**
 * Duplicating is not a gfm command, so it is a hand-rolled transaction — which
 * is no loss: one transaction is one undo step, exactly what a duplicate should
 * be.
 */
export function duplicateRow(view: EditorView, tablePos: number, row: number) {
  const grid = resolveGrid(view, tablePos);
  // Cloning the header row would produce a second `table_header_row`, which
  // the schema forbids.
  if (!grid || row < 1 || row >= grid.rows) return;

  let insertAt = grid.start;
  for (let i = 0; i <= row; i += 1) insertAt += grid.node.child(i).nodeSize;

  const clone = grid.node.child(row).copy(grid.node.child(row).content);
  view.dispatch(view.state.tr.insert(insertAt, clone).scrollIntoView());
  focusCell(view, tablePos, row + 1, 0);
}

export function duplicateColumn(view: EditorView, tablePos: number, col: number) {
  const grid = resolveGrid(view, tablePos);
  if (!grid || col < 0 || col >= grid.cols) return;

  // Collect every insertion against the *original* geometry, then apply them
  // bottom-up so earlier positions stay valid as the document grows.
  const inserts: { at: number; node: Node }[] = [];
  for (let row = 0; row < grid.rows; row += 1) {
    const pos = cellPos(grid, row, col);
    if (pos === null) continue;
    const cell = view.state.doc.nodeAt(pos);
    if (!cell) continue;
    inserts.push({ at: pos + cell.nodeSize, node: cell.copy(cell.content) });
  }
  if (inserts.length === 0) return;

  const tr = view.state.tr;
  for (const { at, node } of inserts.reverse()) tr.insert(at, node);
  view.dispatch(tr.scrollIntoView());
  focusCell(view, tablePos, 0, col + 1);
}

/* ---------- alignment ---------- */

/**
 * Alignment is a per-cell attribute, but only the header row's copy survives
 * serialisation (`:---`, `:---:`, `---:` in the delimiter row) — the gfm
 * preset's `keepTableAlignPlugin` then mirrors it down the column. So read the
 * header cell, and write to the whole column.
 */
export function alignmentOf(view: EditorView, tablePos: number, col: number): Alignment {
  const grid = resolveGrid(view, tablePos);
  if (!grid) return 'left';
  const pos = cellPos(grid, 0, col);
  if (pos === null) return 'left';
  const alignment = view.state.doc.nodeAt(pos)?.attrs.alignment;
  return alignment === 'center' || alignment === 'right' ? alignment : 'left';
}

export function alignColumn(
  ctx: Ctx,
  view: EditorView,
  tablePos: number,
  col: number,
  alignment: Alignment,
) {
  const grid = resolveGrid(view, tablePos);
  if (!grid) return;
  anchorCol(ctx, grid, col);
  call(ctx, setAlignCommand.key, alignment);
}
