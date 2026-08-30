import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import {
  MergeView,
  getChunks,
  goToNextChunk,
  goToPreviousChunk,
  unifiedMergeView,
} from '@codemirror/merge';
import { Annotation, EditorState, type Extension } from '@codemirror/state';
import { EditorView, drawSelection, keymap, lineNumbers } from '@codemirror/view';

import { getFullText, useDocStore } from '@/core/document/store';
import { diffToChanges } from '@/editors/raw/diff-apply';
import { rawEditorTheme, rawSyntaxHighlighting } from '@/editors/raw/theme';

/** Transactions carrying this annotation come from the store — never re-pushed (loop guard). */
const diffSyncAnnotation = Annotation.define<boolean>();

export interface ChunkInfo {
  /** 1-based index of the chunk at/above the cursor; 0 when the cursor is before the first. */
  current: number;
  total: number;
}

export interface DiffEditorOptions {
  parent: HTMLElement;
  layout: 'split' | 'unified';
  /** Baseline text (last saved version; '' for never-saved documents). */
  original: string;
  wrap: boolean;
  collapse: boolean;
  onChunkInfo: (info: ChunkInfo) => void;
}

export interface DiffEditorHandle {
  focus(): void;
  nextChunk(): void;
  prevChunk(): void;
  /** Replace the whole document with the baseline — one undoable transaction. */
  revertAll(): void;
  destroy(): void;
}

/**
 * Colors for @codemirror/merge's decorations, over the app's CSS variables so
 * theme switches are instant (FR-13.1). The library's own light/dark variants
 * never apply (the app themes by variables, not by CM's darkTheme facet).
 */
const diffTheme = EditorView.theme({
  '&.cm-merge-a .cm-changedLine': { backgroundColor: 'var(--diff-del-line)' },
  '&.cm-merge-b .cm-changedLine, .cm-inlineChangedLine': {
    backgroundColor: 'var(--diff-add-line)',
  },
  '&.cm-merge-a .cm-changedText, .cm-deletedChunk .cm-deletedText': {
    background: 'var(--diff-del-text)',
    borderRadius: '2px',
  },
  '&.cm-merge-b .cm-changedText': {
    background: 'var(--diff-add-text)',
    borderRadius: '2px',
  },
  '&.cm-merge-a .cm-changedLineGutter, .cm-deletedLineGutter': {
    background: 'var(--diff-del-accent)',
  },
  '&.cm-merge-b .cm-changedLineGutter': { background: 'var(--diff-add-accent)' },
  '.cm-deletedChunk': { backgroundColor: 'var(--diff-del-line)' },
  '.cm-collapsedLines': {
    color: 'var(--muted-foreground)',
    background: 'var(--muted)',
    padding: '4px 16px',
    fontSize: '12px',
  },
});

/** Lucide `undo-2` — static markup, no document-derived content. */
const REVERT_ICON_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>';

/**
 * The per-chunk revert control (split view). The merge view positions it in
 * its own gutter column and handles the click by delegation — no listener here.
 */
function renderRevertControl(): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'diff-revert-btn';
  btn.title = 'Revert this change';
  btn.setAttribute('aria-label', 'Revert this change');
  btn.innerHTML = REVERT_ICON_SVG;
  return btn;
}

/**
 * Unified-view chunk controls: only "reject" (= revert to saved) makes sense
 * here — "accept" would rewrite the comparison baseline away from the saved
 * file, silently desyncing the view from what Ctrl+S writes.
 */
function renderUnifiedControl(
  type: 'accept' | 'reject',
  action: (e: MouseEvent) => void,
): HTMLElement {
  if (type === 'accept') {
    const hidden = document.createElement('span');
    hidden.style.display = 'none';
    return hidden;
  }
  const btn = renderRevertControl();
  btn.addEventListener('mousedown', action);
  return btn;
}

function reportChunkInfo(view: EditorView, cb: (info: ChunkInfo) => void) {
  const found = getChunks(view.state);
  if (!found) {
    cb({ current: 0, total: 0 });
    return;
  }
  const head = view.state.selection.main.head;
  let current = 0;
  found.chunks.forEach((chunk, i) => {
    if (chunk.fromB <= head) current = i + 1;
  });
  cb({ current, total: found.chunks.length });
}

/** Extensions for the editable (current-document) side. */
function editableExtensions(opts: DiffEditorOptions): Extension[] {
  return [
    lineNumbers(),
    history(),
    drawSelection(),
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    rawEditorTheme,
    rawSyntaxHighlighting,
    diffTheme,
    opts.wrap ? EditorView.lineWrapping : [],
    keymap.of([
      { key: 'Alt-ArrowDown', run: goToNextChunk, preventDefault: true },
      { key: 'Alt-ArrowUp', run: goToPreviousChunk, preventDefault: true },
      ...defaultKeymap,
      ...historyKeymap,
    ]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const isSync = update.transactions.some((tr) => tr.annotation(diffSyncAnnotation));
        // Push every keystroke, like raw mode — the draft guard sees it all.
        if (!isSync) useDocStore.getState().setFullText(update.state.doc.toString(), 'diff');
      }
      if (update.docChanged || update.selectionSet) reportChunkInfo(update.view, opts.onChunkInfo);
    }),
    EditorView.contentAttributes.of({ 'aria-label': 'Current document' }),
  ];
}

/** Extensions for the read-only (last saved) side of the split view. */
function readonlyExtensions(wrap: boolean): Extension[] {
  return [
    lineNumbers(),
    drawSelection(),
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    rawEditorTheme,
    rawSyntaxHighlighting,
    diffTheme,
    wrap ? EditorView.lineWrapping : [],
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    EditorView.contentAttributes.of({ 'aria-label': 'Last saved version (read-only)' }),
  ];
}

/**
 * The Review Changes editor. The editable side IS the live document: edits
 * push to the store as origin 'diff' (raw/WYSIWYG apply them under the usual
 * guards), and external versions land here as annotated minimal diffs — the
 * same protocol as the raw adapter (plan §2.2).
 */
export function createDiffEditor(opts: DiffEditorOptions): DiffEditorHandle {
  const current = getFullText(useDocStore.getState());
  const collapseUnchanged = opts.collapse ? { margin: 3, minSize: 4 } : undefined;
  /**
   * The library's default scanLimit (500 changed characters) is tuned for
   * typing-time updates; a WYSIWYG re-serialization (D13) of a table-heavy
   * document legitimately rewrites thousands of characters, and past the limit
   * the diff degrades to one imprecise whole-document chunk — every line
   * marked changed. A deliberate review action can afford a real diff; the
   * timeout keeps pathological megabyte inputs from freezing the UI.
   */
  const diffConfig = { scanLimit: 20_000, timeout: 1_000 };

  let mergeView: MergeView | null = null;
  let editable: EditorView;

  if (opts.layout === 'split') {
    mergeView = new MergeView({
      parent: opts.parent,
      a: { doc: opts.original, extensions: readonlyExtensions(opts.wrap) },
      b: { doc: current, extensions: editableExtensions(opts) },
      revertControls: 'a-to-b',
      renderRevertControl,
      highlightChanges: true,
      gutter: true,
      collapseUnchanged,
      diffConfig,
    });
    editable = mergeView.b;
  } else {
    editable = new EditorView({
      parent: opts.parent,
      state: EditorState.create({
        doc: current,
        extensions: [
          unifiedMergeView({
            original: opts.original,
            highlightChanges: true,
            gutter: true,
            collapseUnchanged,
            mergeControls: renderUnifiedControl,
            diffConfig,
          }),
          ...editableExtensions(opts),
        ],
      }),
    });
  }

  // Same as the raw adapter: flush CM's rAF-deferred first measurement now, or
  // the overlay paints with both gutters one padding-step above their lines
  // until something else re-syncs them.
  if (mergeView) mergeView.a.coordsAtPos(0);
  editable.coordsAtPos(0);

  // Store → diff: another editor's (or the metadata panel's) debounced push
  // can land while the overlay is open; apply it as a cursor-preserving diff.
  const unsubscribe = useDocStore.subscribe((s, prev) => {
    if (s.version === prev.version || s.origin === 'diff' || s.status !== 'open') return;
    const newText = getFullText(s);
    const cur = editable.state.doc.toString();
    if (cur === newText) return;
    editable.dispatch({
      changes: diffToChanges(cur, newText),
      annotations: diffSyncAnnotation.of(true),
    });
  });

  reportChunkInfo(editable, opts.onChunkInfo);

  return {
    focus: () => editable.focus(),
    nextChunk: () => {
      editable.focus();
      goToNextChunk(editable);
    },
    prevChunk: () => {
      editable.focus();
      goToPreviousChunk(editable);
    },
    revertAll: () => {
      if (editable.state.doc.toString() === opts.original) return;
      editable.focus();
      editable.dispatch({
        changes: { from: 0, to: editable.state.doc.length, insert: opts.original },
      });
    },
    destroy: () => {
      unsubscribe();
      if (mergeView) mergeView.destroy();
      else editable.destroy();
    },
  };
}
