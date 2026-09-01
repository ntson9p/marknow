import { commandsCtx, editorViewCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import { addRowAfterCommand } from '@milkdown/kit/preset/gfm';
import { keymap } from '@milkdown/kit/prose/keymap';
import { TextSelection, type Command } from '@milkdown/kit/prose/state';
import { isInTable, selectionCell, TableMap } from '@milkdown/kit/prose/tables';
import { $prose } from '@milkdown/kit/utils';

import { tableBreakSchema } from '../nodes/table-break';

/**
 * Enter inside a table starts a new line in the cell (FR-5.7), as Docs, Word
 * and Notion all do.
 *
 * This binding used to move to the cell below, on the premise that a markdown
 * cell cannot hold a line break. Half true: a pipe-table row is one line of
 * source, so there is no *native* break — but `<br>` is legal, universal, and
 * what every markdown table with a wrapped cell in the wild contains. See
 * `nodes/table-break.ts` for why it is its own node.
 *
 * Nothing is lost by giving Enter back to the text. Moving between cells is
 * already Tab (next), Shift-Tab (previous) and the arrow keys (any direction),
 * all of which worked before this change; leaving the table entirely is still
 * Mod-Enter, which the gfm preset binds to `ExitTable`.
 *
 * Shift-Enter maps here too. It is the other break gesture people arrive with,
 * and in a cell it did nothing at all: some handler upstream claimed the
 * keystroke and inserted no break, so it read as a dead key. Binding it ahead
 * of the presets settles that.
 */
const insertCellBreak =
  (ctx: Ctx): Command =>
  (state, dispatch) => {
    if (!isInTable(state)) return false;
    // A cell selection means Enter is aimed at the cells, not at their text —
    // leave it to the preset rather than typing into an ambiguous target.
    if (!(state.selection instanceof TextSelection)) return false;
    if (!dispatch) return true;

    dispatch(state.tr.replaceSelectionWith(tableBreakSchema.type(ctx).create()).scrollIntoView());
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
  keymap({
    Enter: insertCellBreak(ctx),
    'Shift-Enter': insertCellBreak(ctx),
    Tab: appendRowAtEnd(ctx),
  }),
);
