import { afterEach, describe, expect, it } from 'vitest';
import { history } from '@codemirror/commands';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import { createSourceToolbarCommands } from '@/editors/raw/toolbar-commands';

let views: EditorView[] = [];

function makeView(doc: string, from: number, to = from): EditorView {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.single(from, to),
    extensions: [history()],
  });
  const view = new EditorView({ state, parent: document.body });
  views.push(view);
  return view;
}

function selected(view: EditorView): string {
  const { from, to } = view.state.selection.main;
  return view.state.sliceDoc(from, to);
}

afterEach(() => {
  views.forEach((v) => v.destroy());
  views = [];
});

describe('createSourceToolbarCommands (dual-mode toolbar → source pane)', () => {
  it('delegates inline marks to the FR-3.5 format commands', () => {
    const view = makeView('make this bold', 5, 9);
    createSourceToolbarCommands(view).strong();
    expect(view.state.doc.toString()).toBe('make **this** bold');
  });

  it('routes undo/redo to the CodeMirror history', () => {
    const view = makeView('word', 0, 4);
    const commands = createSourceToolbarCommands(view);
    commands.strong();
    expect(view.state.doc.toString()).toBe('**word**');
    commands.undo();
    expect(view.state.doc.toString()).toBe('word');
    commands.redo();
    expect(view.state.doc.toString()).toBe('**word**');
  });

  it('sets heading levels 1–6 via the block-type menu', () => {
    const view = makeView('Title', 2);
    createSourceToolbarCommands(view).setBlockType('h4');
    expect(view.state.doc.toString()).toBe('#### Title');
  });

  it('converts back to paragraph by stripping the line prefix', () => {
    const view = makeView('## Title', 4);
    createSourceToolbarCommands(view).setBlockType('paragraph');
    expect(view.state.doc.toString()).toBe('Title');
  });

  it('creates an empty fenced code block with the caret inside', () => {
    const view = makeView('', 0);
    createSourceToolbarCommands(view).setBlockType('code');
    expect(view.state.doc.toString()).toBe('```\n\n```');
    expect(view.state.selection.main.head).toBe(4);
  });

  it('wraps the selected lines in a code fence', () => {
    const view = makeView('const x = 1\nconst y = 2', 3, 15);
    createSourceToolbarCommands(view).setBlockType('code');
    expect(view.state.doc.toString()).toBe('```\nconst x = 1\nconst y = 2\n```');
  });

  it('wraps the selected lines in a callout', () => {
    const view = makeView('line a\nline b', 0, 13);
    createSourceToolbarCommands(view).setBlockType('callout');
    expect(view.state.doc.toString()).toBe('> [!note]\n> line a\n> line b');
  });

  it('inserts a 3×3 table (compact style, FR-13.2 default) with the caret in the first cell', () => {
    const view = makeView('', 0);
    createSourceToolbarCommands(view).table();
    expect(view.state.doc.toString()).toBe('| | | |\n| - | - | - |\n| | | |\n| | | |');
    expect(view.state.selection.main.head).toBe(2);
  });

  it('pads a table with blank lines when inserted between paragraphs', () => {
    const doc = 'para one\n\npara two';
    const view = makeView(doc, 9); // caret on the empty line
    createSourceToolbarCommands(view).table();
    expect(view.state.doc.toString()).toBe(
      'para one\n\n| | | |\n| - | - | - |\n| | | |\n| | | |\n\npara two',
    );
  });

  it('splits a paragraph around a block inserted mid-line', () => {
    const view = makeView('hello world', 5);
    createSourceToolbarCommands(view).divider();
    expect(view.state.doc.toString()).toBe('hello\n\n---\n\nworld');
  });

  it('inserts a divider with the caret parked below it', () => {
    const view = makeView('above\n', 6);
    createSourceToolbarCommands(view).divider();
    expect(view.state.doc.toString()).toBe('above\n\n---\n');
    expect(view.state.selection.main.head).toBe(view.state.doc.length);
  });

  it('wraps the selection in a math block and keeps it selected', () => {
    const view = makeView('x = 1', 0, 5);
    createSourceToolbarCommands(view).mathBlock();
    expect(view.state.doc.toString()).toBe('$$\nx = 1\n$$');
    expect(selected(view)).toBe('x = 1');
  });

  it('toggles inline math delimiters', () => {
    const view = makeView('E = mc2', 0, 7);
    const commands = createSourceToolbarCommands(view);
    commands.mathInline();
    expect(view.state.doc.toString()).toBe('$E = mc2$');
    commands.mathInline();
    expect(view.state.doc.toString()).toBe('E = mc2');
  });

  it('inserts a mermaid fence with the starter selected for overtyping', () => {
    const view = makeView('', 0);
    createSourceToolbarCommands(view).diagram();
    expect(view.state.doc.toString()).toBe('```mermaid\ngraph TD\n  A[Start] --> B[End]\n```');
    expect(selected(view)).toBe('graph TD\n  A[Start] --> B[End]');
  });

  it('uses the selection as image alt text', () => {
    const view = makeView('my pic here', 3, 6);
    createSourceToolbarCommands(view).image('cat.png');
    expect(view.state.doc.toString()).toBe('my ![pic](cat.png) here');
  });

  it('quotes the current line', () => {
    const view = makeView('quote me', 0);
    createSourceToolbarCommands(view).quote();
    expect(view.state.doc.toString()).toBe('> quote me');
  });

  // The code button used to need a selection to do anything at all. With a
  // bare caret the line now decides which construct it gets — matching the
  // WYSIWYG pane's `insertCodeCommand`.
  describe('code button with no selection', () => {
    it('opens a fenced block on an empty line, caret on the blank line inside', () => {
      const view = makeView('', 0);
      createSourceToolbarCommands(view).inlineCode();
      expect(view.state.doc.toString()).toBe('```\n\n```');
      expect(view.state.selection.main.head).toBe(4);
    });

    it('treats a whitespace-only line as empty', () => {
      const view = makeView('   ', 3);
      createSourceToolbarCommands(view).inlineCode();
      expect(view.state.doc.toString()).toBe('```\n\n```');
      expect(view.state.selection.main.head).toBe(4);
    });

    it('pads the fence with blank lines when the neighbours are prose', () => {
      const view = makeView('before\n\nafter', 7);
      createSourceToolbarCommands(view).inlineCode();
      expect(view.state.doc.toString()).toBe('before\n\n```\n\n```\n\nafter');
    });

    it('opens a backtick pair on a non-empty line, caret between them', () => {
      const view = makeView('run ', 4);
      createSourceToolbarCommands(view).inlineCode();
      expect(view.state.doc.toString()).toBe('run ``');
      expect(view.state.selection.main.head).toBe(5);
    });

    it('still wraps a selection rather than fencing it', () => {
      const view = makeView('run npm i now', 4, 9);
      createSourceToolbarCommands(view).inlineCode();
      expect(view.state.doc.toString()).toBe('run `npm i` now');
    });

    it('unwraps again on a second press', () => {
      const view = makeView('run npm i now', 4, 9);
      const commands = createSourceToolbarCommands(view);
      commands.inlineCode();
      commands.inlineCode();
      expect(view.state.doc.toString()).toBe('run npm i now');
    });
  });
});
