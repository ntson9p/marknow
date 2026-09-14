import type { CmdKey, Editor } from '@milkdown/kit/core';
import { commandsCtx, editorViewCtx } from '@milkdown/kit/core';
import { redoCommand, undoCommand } from '@milkdown/kit/plugin/history';
import {
  createCodeBlockCommand,
  insertHrCommand,
  insertImageCommand,
  toggleEmphasisCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInHeadingCommand,
} from '@milkdown/kit/preset/commonmark';
import { insertTableCommand, toggleStrikethroughCommand } from '@milkdown/kit/preset/gfm';

import type { ToolbarCommands } from '@/editors/toolbar-commands';

import {
  insertCodeCommand,
  insertDiagramCommand,
  insertMathBlockCommand,
  insertMathInlineCommand,
  wrapInCalloutCommand,
} from './commands';
import { setListCommand } from './list-commands';
import type { BlockType } from './selection-state';
import { triggerLinkEdit } from './shortcuts';

/**
 * Toolbar adapter for the WYSIWYG (Milkdown) pane. Every action runs the
 * command and returns focus to the editor, so the toolbar never strands the
 * caret. A null editor (still mounting) makes every action a no-op.
 */
export function createRichToolbarCommands(editor: Editor | null): ToolbarCommands {
  function run<T>(key: CmdKey<T>, payload?: T) {
    editor?.action((ctx) => {
      ctx.get(commandsCtx).call(key, payload);
      ctx.get(editorViewCtx).focus();
    });
  }

  return {
    undo: () => run(undoCommand.key),
    redo: () => run(redoCommand.key),
    setBlockType: (type: BlockType) => {
      if (type.startsWith('h')) {
        run(wrapInHeadingCommand.key, Number(type.slice(1)));
      } else if (type === 'quote') {
        run(wrapInBlockquoteCommand.key);
      } else if (type === 'code') {
        run(createCodeBlockCommand.key);
      } else if (type === 'callout') {
        run(wrapInCalloutCommand.key);
      } else {
        run(turnIntoTextCommand.key);
      }
    },
    strong: () => run(toggleStrongCommand.key),
    emphasis: () => run(toggleEmphasisCommand.key),
    strikethrough: () => run(toggleStrikethroughCommand.key),
    // Not `run`: on an empty line this creates a code block, whose NodeView
    // focuses its own CodeMirror — the blanket refocus would snatch it back.
    inlineCode: () =>
      editor?.action((ctx) => {
        ctx.get(commandsCtx).call(insertCodeCommand.key);
        const view = ctx.get(editorViewCtx);
        if (!view.state.selection.$head.parent.type.spec.code) view.focus();
      }),
    link: () =>
      editor?.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        triggerLinkEdit(ctx, view.state);
      }),
    bulletList: () => run(setListCommand.key, 'bullet'),
    orderedList: () => run(setListCommand.key, 'ordered'),
    taskList: () => run(setListCommand.key, 'task'),
    table: () => run(insertTableCommand.key, { row: 3, col: 3 }),
    image: (src: string) => run(insertImageCommand.key, { src }),
    mathInline: () => run(insertMathInlineCommand.key, ''),
    quote: () => run(wrapInBlockquoteCommand.key),
    callout: () => run(wrapInCalloutCommand.key, 'note'),
    divider: () => run(insertHrCommand.key),
    mathBlock: () => run(insertMathBlockCommand.key, ''),
    diagram: () => run(insertDiagramCommand.key),
  };
}
