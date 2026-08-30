import type { Ctx } from '@milkdown/kit/ctx';
import { Plugin } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

import { closeTableMenu, contextMenuItems, menuTarget, openTableMenu } from '../views/table-menu';

/**
 * Right-click inside a table (FR-5.7), plus the keyboard equivalents.
 *
 * This is what makes the pills' header-row activation affordable. The pills
 * follow the header row and the first column, which keeps the chrome quiet;
 * every other cell reaches the same operations from where the pointer already
 * is. It is also the only keyboard route to a structural table edit — Shift+F10
 * and the Menu key open the same list, anchored on the caret.
 */

interface TableTarget {
  tablePos: number;
  row: number;
  col: number;
}

/** Resolve which table cell a document position sits in, if any. */
function targetAt(view: EditorView, pos: number): TableTarget | null {
  if (pos < 0 || pos > view.state.doc.content.size) return null;
  const $pos = view.state.doc.resolve(pos);
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if ($pos.node(depth).type.name !== 'table') continue;
    // Below the table: row at depth + 1, cell at depth + 2. Without both we
    // cannot name a row and a column, so there is nothing to act on.
    if ($pos.depth < depth + 1) return null;
    return {
      tablePos: $pos.before(depth),
      row: $pos.index(depth),
      col: $pos.index(depth + 1),
    };
  }
  return null;
}

function open(ctx: Ctx, view: EditorView, target: TableTarget, anchor: DOMRect) {
  const menu = menuTarget(ctx, view, target.tablePos);
  if (!menu) return false;
  openTableMenu({
    items: contextMenuItems(menu, target.row, target.col),
    anchor,
    label: 'Table options',
    onClose: () => view.focus(),
  });
  return true;
}

export const tableContextMenu = $prose(
  (ctx) =>
    new Plugin({
      props: {
        handleDOMEvents: {
          contextmenu: (view, event) => {
            if (!view.editable) return false;
            const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
            if (!at) return false;
            const target = targetAt(view, at.pos);
            if (!target) return false;

            event.preventDefault();
            // A zero-size rect at the pointer: the menu places itself against
            // the cursor the way a native context menu does.
            const anchor = new DOMRect(event.clientX, event.clientY, 0, 0);
            return open(ctx, view, target, anchor);
          },
        },
        handleKeyDown: (view, event) => {
          const isMenuKey = event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey);
          if (!isMenuKey || !view.editable) return false;
          const target = targetAt(view, view.state.selection.from);
          if (!target) return false;

          event.preventDefault();
          const coords = view.coordsAtPos(view.state.selection.from);
          const anchor = new DOMRect(coords.left, coords.bottom, 0, 0);
          return open(ctx, view, target, anchor);
        },
      },
      view: () => ({
        // A menu outliving its editor would be a body-level orphan.
        destroy: () => closeTableMenu(),
      }),
    }),
);
