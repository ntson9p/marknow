import type { BlockType } from '@/editors/wysiwyg/selection-state';

/**
 * Smallest table either pane may insert: GFM needs a header row, and the
 * WYSIWYG schema spells the rest out as `table_header_row table_row+`, so a
 * header on its own is not a table. Milkdown's own `|3x3|` input rule clamps
 * the same way.
 */
export const MIN_TABLE_ROWS = 2;

/**
 * Everything the formatting toolbar can ask an editor pane to do.
 *
 * Two implementations exist — `createRichToolbarCommands` (Milkdown) and
 * `createSourceToolbarCommands` (CodeMirror) — so in dual mode the toolbar
 * drives whichever pane the cursor was last in. The shared interface keeps the
 * panes in parity: a new toolbar action must be implemented for both.
 */
export interface ToolbarCommands {
  undo(): void;
  redo(): void;
  /** Convert the current block(s) to the given type. */
  setBlockType(type: BlockType): void;
  strong(): void;
  emphasis(): void;
  strikethrough(): void;
  inlineCode(): void;
  /** Start link editing for the current selection. */
  link(): void;
  bulletList(): void;
  orderedList(): void;
  taskList(): void;
  /**
   * Insert an empty table `rows` rows tall — the first one is the header —
   * and `cols` columns wide. Never fewer than `MIN_TABLE_ROWS` rows.
   */
  table(rows: number, cols: number): void;
  image(src: string): void;
  mathInline(): void;
  quote(): void;
  callout(): void;
  divider(): void;
  mathBlock(): void;
  diagram(): void;
}
