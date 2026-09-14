import { redo, undo } from '@codemirror/commands';
import type { Command, EditorView } from '@codemirror/view';

import type { ToolbarCommands } from '@/editors/toolbar-commands';
import type { BlockType } from '@/editors/wysiwyg/selection-state';
import { useSettingsStore } from '@/features/settings/store';

import { formatCommands, setHeading, toggleInlineMark, toggleLinePrefix } from './format-commands';

/**
 * Toolbar adapter for the source pane (dual mode): the same actions the
 * WYSIWYG pane offers, expressed as plain markdown text edits in the FR-3.5
 * style. Inline toggles and line prefixes reuse `formatCommands`; the
 * insert-family actions produce the exact syntax the WYSIWYG serializer emits,
 * so a block inserted from either pane round-trips identically.
 */

/** Starter contents matching the WYSIWYG insert commands' defaults. */
const DIAGRAM_STARTER = 'graph TD\n  A[Start] --> B[End]';
const MERMAID_OPEN = '```mermaid\n';

/**
 * Empty `rows`×`cols` table exactly as the WYSIWYG serializer would emit it
 * under the current table-style pref (FR-13.2), so a table inserted from either
 * pane round-trips byte-identically. Row one is the header the delimiter row
 * under it describes, so a table is never shorter than two rows.
 */
function tableStarter(rows: number, cols: number): string {
  const aligned = useSettingsStore.getState().markdownStyle.tableAlign;
  const row = '|' + (aligned ? '   |' : ' |').repeat(cols);
  const delimiter = '|' + ' - |'.repeat(cols);
  return [row, delimiter, ...Array<string>(rows - 1).fill(row)].join('\n');
}

interface InsertBlockOptions {
  /** Range to replace; defaults to the main selection. */
  replace?: { from: number; to: number };
  /** Caret (or selected range) within `block`; defaults to the block's end. */
  inner?: { from: number; to?: number };
}

/**
 * Replace a range with `block` placed on its own line(s), adding the blank
 * lines markdown needs around block constructs. Partial-line text around the
 * range survives as separate paragraphs.
 */
function insertBlock(view: EditorView, block: string, options: InsertBlockOptions = {}): boolean {
  const { state } = view;
  const range = options.replace ?? state.selection.main;
  const startLine = state.doc.lineAt(range.from);
  const endLine = state.doc.lineAt(range.to);
  const before = state.sliceDoc(startLine.from, range.from).trimEnd();
  const after = state.sliceDoc(range.to, endLine.to).trimStart();

  // A block-final newline is only there to park the caret below the block
  // (divider); when kept text follows, the joining blank line supplies it.
  const body = after ? block.replace(/\n$/, '') : block;
  const pieces = [...(before ? [before] : []), body, ...(after ? [after] : [])];
  let insert = pieces.join('\n\n');
  let blockStart = startLine.from + (before ? before.length + 2 : 0);

  const prevLine = startLine.number > 1 ? state.doc.line(startLine.number - 1) : null;
  const nextLine = endLine.number < state.doc.lines ? state.doc.line(endLine.number + 1) : null;
  if (!before && prevLine && prevLine.text.trim() !== '') {
    insert = '\n' + insert;
    blockStart += 1;
  }
  if (!after && nextLine && nextLine.text.trim() !== '') insert += '\n';

  const insertEnd = startLine.from + insert.length;
  const anchor = Math.min(blockStart + (options.inner?.from ?? block.length), insertEnd);
  const head =
    options.inner?.to !== undefined ? Math.min(blockStart + options.inner.to, insertEnd) : anchor;
  view.dispatch({
    changes: { from: startLine.from, to: endLine.to, insert },
    selection: { anchor, head },
    scrollIntoView: true,
    userEvent: 'input',
  });
  return true;
}

/** The caret lands in the first header cell, two columns past its pipe. */
const insertTable =
  (rows: number, cols: number): Command =>
  (view) =>
    insertBlock(view, tableStarter(rows, cols), { inner: { from: 2 } });

/** `---` with the caret parked on the line below, like the WYSIWYG insert. */
const insertHorizontalRule: Command = (view) => insertBlock(view, '---\n', { inner: { from: 4 } });

const insertMathBlock: Command = (view) => {
  const { from, to } = view.state.selection.main;
  const content = view.state.sliceDoc(from, to);
  return insertBlock(view, `$$\n${content}\n$$`, { inner: { from: 3, to: 3 + content.length } });
};

const insertDiagram: Command = (view) =>
  insertBlock(view, MERMAID_OPEN + DIAGRAM_STARTER + '\n```', {
    // Starter selected, so typing replaces it.
    inner: { from: MERMAID_OPEN.length, to: MERMAID_OPEN.length + DIAGRAM_STARTER.length },
  });

/** Wrap the selection's full lines in a fence, caret at the end of the code. */
const wrapInFences: Command = (view) => {
  const { state } = view;
  const range = state.selection.main;
  const startLine = state.doc.lineAt(range.from);
  const endLine = state.doc.lineAt(range.to);
  const content = state.sliceDoc(startLine.from, endLine.to);
  return insertBlock(view, content ? `\`\`\`\n${content}\n\`\`\`` : '```\n\n```', {
    replace: { from: startLine.from, to: endLine.to },
    inner: { from: 4 + content.length },
  });
};

/**
 * The code action, matching the WYSIWYG pane's `insertCodeCommand`: a bare
 * caret on an empty line opens a fenced block with the caret on the blank line
 * inside it. Anywhere else the backtick pair does its usual work — wrapping a
 * selection, or opening an empty pair around the caret. Source is text, so
 * unlike the rich pane there is nothing here that needs arming.
 */
export const insertCode: Command = (view) => {
  const { state } = view;
  const range = state.selection.main;
  if (!range.empty) return formatCommands.inlineCode(view);

  const line = state.doc.lineAt(range.head);
  if (line.text.trim() !== '') return formatCommands.inlineCode(view);
  // The whole line goes, not just the caret: `wrapInFences` would keep a blank
  // line's indentation and hand the new block a first line of stray spaces.
  return insertBlock(view, '```\n\n```', {
    replace: { from: line.from, to: line.to },
    inner: { from: 4 },
  });
};

/** `> [!note]` callout wrapping the selection's full lines (FR-5.10 syntax). */
const insertCallout: Command = (view) => {
  const { state } = view;
  const range = state.selection.main;
  const startLine = state.doc.lineAt(range.from);
  const endLine = state.doc.lineAt(range.to);
  const content = state.sliceDoc(startLine.from, endLine.to);
  const body = content
    ? content
        .split('\n')
        .map((line) => (line ? `> ${line}` : '>'))
        .join('\n')
    : '> ';
  const block = `> [!note]\n${body}`;
  return insertBlock(view, block, {
    replace: { from: startLine.from, to: endLine.to },
    inner: { from: block.length },
  });
};

/** Strip any heading/list/quote prefix from the selected lines. */
const clearBlockPrefix = toggleLinePrefix('');

function setSourceBlockType(view: EditorView, type: BlockType): void {
  if (type.startsWith('h')) setHeading(Number(type.slice(1)))(view);
  else if (type === 'quote') formatCommands.quote(view);
  else if (type === 'code') wrapInFences(view);
  else if (type === 'callout') insertCallout(view);
  else clearBlockPrefix(view);
}

export function createSourceToolbarCommands(view: EditorView): ToolbarCommands {
  // Commands act on the selection without needing focus (toolbar clicks keep
  // focus in the pane anyway); focus() covers the dropdown-menu paths.
  const exec = (command: Command) => {
    command(view);
    view.focus();
  };

  return {
    undo: () => exec(undo),
    redo: () => exec(redo),
    setBlockType: (type: BlockType) => {
      setSourceBlockType(view, type);
      view.focus();
    },
    strong: () => exec(formatCommands.bold),
    emphasis: () => exec(formatCommands.italic),
    strikethrough: () => exec(formatCommands.strikethrough),
    inlineCode: () => exec(insertCode),
    link: () => exec(formatCommands.link),
    bulletList: () => exec(formatCommands.bulletList),
    orderedList: () => exec(formatCommands.orderedList),
    taskList: () => exec(formatCommands.taskList),
    table: (rows, cols) => exec(insertTable(rows, cols)),
    image: (src: string) => {
      const { from, to } = view.state.selection.main;
      const alt = view.state.sliceDoc(from, to);
      const text = `![${alt}](${src})`;
      view.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length },
        scrollIntoView: true,
        userEvent: 'input',
      });
      view.focus();
    },
    mathInline: () => exec(toggleInlineMark('$')),
    quote: () => exec(formatCommands.quote),
    callout: () => exec(insertCallout),
    divider: () => exec(insertHorizontalRule),
    mathBlock: () => exec(insertMathBlock),
    diagram: () => exec(insertDiagram),
  };
}
