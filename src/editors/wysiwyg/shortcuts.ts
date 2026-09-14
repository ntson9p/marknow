import { linkTooltipAPI } from '@milkdown/kit/component/link-tooltip';
import { commandsCtx } from '@milkdown/kit/core';
import type { CmdKey } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import { wrapInBlockquoteCommand, wrapInHeadingCommand } from '@milkdown/kit/preset/commonmark';
import { toggleStrikethroughCommand } from '@milkdown/kit/preset/gfm';
import { keymap } from '@milkdown/kit/prose/keymap';
import type { EditorState } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';

import { insertCodeCommand } from './commands';
import { setListCommand } from './list-commands';

/**
 * The §9.3 shortcut set for WYSIWYG mode (FR-5.3), on top of the preset
 * defaults (Mod-B bold, Mod-I italic, history, etc.). Registered before the
 * presets so these bindings win conflicts.
 */

/** Contiguous range of the link mark around the caret, if any. */
export function linkRangeAtCaret(
  state: EditorState,
): { from: number; to: number; mark: import('@milkdown/kit/prose/model').Mark } | null {
  const linkType = state.schema.marks.link;
  if (!linkType) return null;
  const { $from, empty } = state.selection;
  if (!empty) return null;
  const mark = linkType.isInSet(state.storedMarks ?? $from.marks());
  if (!mark) return null;

  const parentStart = $from.start();
  let from = -1;
  let to = -1;
  $from.parent.forEach((child, offset) => {
    const childFrom = parentStart + offset;
    const childTo = childFrom + child.nodeSize;
    if (mark.isInSet(child.marks)) {
      if (from === -1) {
        from = childFrom;
        to = childTo;
      } else if (childFrom === to) {
        to = childTo;
      }
    }
  });
  if (from === -1 || $from.pos < from || $from.pos > to) return null;
  return { from, to, mark };
}

export const wysiwygKeymap = $prose((ctx) => {
  function call<T>(cmd: { key: CmdKey<T> }, payload?: T) {
    return () => {
      try {
        return ctx.get(commandsCtx).call(cmd.key, payload);
      } catch {
        return false;
      }
    };
  }

  return keymap({
    // The toolbar button advertises this shortcut by name, so they share one
    // command: inline code, or a fenced block when the line is empty.
    'Mod-e': call(insertCodeCommand),
    'Mod-Shift-x': call(toggleStrikethroughCommand),
    'Mod-Alt-1': call(wrapInHeadingCommand, 1),
    'Mod-Alt-2': call(wrapInHeadingCommand, 2),
    'Mod-Alt-3': call(wrapInHeadingCommand, 3),
    'Mod-Shift-8': call(setListCommand, 'bullet'),
    'Mod-Shift-7': call(setListCommand, 'ordered'),
    'Mod-Shift-9': call(setListCommand, 'task'),
    'Mod-Shift-b': call(wrapInBlockquoteCommand),
    // Link popover (FR-5.1): edit when the caret is inside a link, create
    // when text is selected.
    'Mod-k': (state) => triggerLinkEdit(ctx, state),
  });
});

/**
 * Open the link tooltip for the current selection: edit mode when the caret
 * is inside a link, create mode when text is selected. Shared by Ctrl+K and
 * the toolbar link button.
 */
export function triggerLinkEdit(ctx: Ctx, state: EditorState): boolean {
  const api = ctx.get(linkTooltipAPI.key);
  const existing = linkRangeAtCaret(state);
  if (existing) {
    api.editLink(existing.mark, existing.from, existing.to);
    return true;
  }
  const { from, to, empty } = state.selection;
  if (empty) return false;
  api.addLink(from, to);
  return true;
}
