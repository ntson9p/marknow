import { commandsCtx, editorViewCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import { addRowAfterCommand } from '@milkdown/kit/preset/gfm';
import { keymap } from '@milkdown/kit/prose/keymap';
import { TextSelection, type Command } from '@milkdown/kit/prose/state';
import { isInTable, selectionCell, TableMap } from '@milkdown/kit/prose/tables';
import { $prose } from '@milkdown/kit/utils';

/**
 * Enter inside a table moves to the cell below (FR-5.7).
 *
 * The gfm preset binds plain Enter to the same `ExitTable` command as
 * Mod-Enter, and `ExitTable` appends a paragraph after the *whole* table. So
 * Enter in the first cell of a 3x3 skipped two untouched rows and landed below
 * everything, with nothing on screen to say a jump had happened.
 *
 * A markdown cell can't hold a line break, so Enter has to mean something other
 * than "split this block". The spreadsheet meaning — down one row, same column
 * — is the one Tab already implies by moving right.
 */
const moveToCellBelow: Command = (state, dispatch) => {
  if (!isInTable(state)) return false;
  // A range selection means Enter is about replacing content, not navigating.
  if (!state.selection.empty) return false;

  const $cell = selectionCell(state);
  // `selectionCell` resolves to the position *before* the cell, i.e. inside the
  // row — so the table is one level up from there.
  const table = $cell.node(-1);
  const tableStart = $cell.start(-1);
  const map = TableMap.get(table);
  const rect = map.findCell($cell.pos - tableStart);

  // Bottom row: hand Enter back to the preset, whose ExitTable still leaves the
  // table exactly as it did before. Keeping that fall-through is what makes
  // this change additive rather than a replacement.
  if (rect.bottom >= map.height) return false;

  if (dispatch) {
    const below = tableStart + map.map[rect.bottom * map.width + rect.left]!;
    const selection = TextSelection.near(state.doc.resolve(below), 1);
    dispatch(state.tr.setSelection(selection).scrollIntoView());
  }
  return true;
};

/**
 * Tab in the last cell grows the table (FR-5.7).
 *
 * The preset binds Tab to `goToNextCell(1)`, which returns false once there is
 * no next cell — so Tab at the bottom-right did nothing at all. Every
 * spreadsheet, and every editor worth copying, appends a row there. It is also
 * the cheapest possible "add a row": an infinite target that costs no chrome,
 * which is why it carries most of the load the old insertion-line `+` was
 * failing to carry.
 *
 * Anywhere else this returns false and the preset's cell-to-cell Tab stands.
 */
const appendRowAtEnd =
  (ctx: Ctx): Command =>
  (state, dispatch) => {
    if (!isInTable(state)) return false;

    const $cell = selectionCell(state);
    const tableStart = $cell.start(-1);
    const map = TableMap.get($cell.node(-1));
    const rect = map.findCell($cell.pos - tableStart);
    if (rect.bottom < map.height || rect.right < map.width) return false;
    if (!dispatch) return true;

    const view = ctx.get(editorViewCtx);
    // `addRowAfter` reads `selectedRect`, which is this cell — so the new row
    // lands below the last one, inheriting the column alignments.
    ctx.get(commandsCtx).call(addRowAfterCommand.key);

    // Inserting inside the table leaves its own start position alone, so the
    // row that just appeared can be found from the geometry we already have.
    const { state: next } = view;
    const table = next.doc.nodeAt(tableStart - 1);
    if (!table) return true;
    const grown = TableMap.get(table);
    const first = grown.map[(grown.height - 1) * grown.width];
    if (first === undefined) return true;
    const selection = TextSelection.near(next.doc.resolve(tableStart + first + 1), 1);
    view.dispatch(next.tr.setSelection(selection).scrollIntoView());
    return true;
  };

/**
 * Registered ahead of the gfm preset so these bindings win the Enter it would
 * otherwise route straight to ExitTable, and the Tab it would drop on the floor.
 */
export const tableEnterKeymap = $prose((ctx) =>
  keymap({ Enter: moveToCellBelow, Tab: appendRowAtEnd(ctx) }),
);
