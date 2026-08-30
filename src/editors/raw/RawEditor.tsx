import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';

import { getFullText, useDocStore } from '@/core/document/store';
import { diffToChanges } from '@/editors/raw/diff-apply';
import {
  buildRawExtensions,
  lineNumbersCompartment,
  syncAnnotation,
  type RawExtensionOptions,
} from '@/editors/raw/extensions';
import { useSettingsStore } from '@/features/settings/store';
import { useEditorsStore } from '@/app/store/editors';
import { useUiStore } from '@/app/store/ui';

interface RawEditorProps {
  /** Exposes the live EditorView (scroll sync, adapters). */
  onViewReady?: (view: EditorView | null) => void;
  autoFocus?: boolean;
  /**
   * Toolbar reflection (dual mode): caret-context selection state. Captured at
   * mount like `onViewReady` — pass a stable callback.
   */
  onSelectionState?: RawExtensionOptions['onSelectionState'];
}

/**
 * CodeMirror 6 raw-mode adapter (FR-3). Edits the FULL text (frontmatter
 * included); the store re-splits. Byte-faithful: nothing is ever reformatted
 * (D13) — external updates apply as minimal diffs.
 */
export function RawEditor({ onViewReady, autoFocus = true, onSelectionState }: RawEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const docId = useDocStore((s) => s.docId);
  const settingsLineNumbers = useSettingsStore((s) => s.lineNumbers);
  const fontSize = useSettingsStore((s) => s.fontSize);

  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: getFullText(useDocStore.getState()),
      extensions: buildRawExtensions({
        lineNumbers: useSettingsStore.getState().lineNumbers,
        onUserChange: (text) => useDocStore.getState().setFullText(text, 'raw'),
        onCursor: (line, col) => useUiStore.getState().setCursor({ line, col }),
        onSelectionText: (text) => useEditorsStore.getState().setSelectionText(text),
        onSelectionState,
      }),
    });
    const view = new EditorView({ state, parent: containerRef.current });
    // CM6 defers its first layout measurement to a rAF callback, and lays the
    // gutter out from it: until it runs, row 1 is missing the `.cm-content` top
    // padding (which CM re-emits as a margin) and every row uses CM's 14px
    // default estimate instead of the real line height — line numbers sit above
    // their lines until the next update happens to re-sync the gutter. Reading
    // geometry flushes that pending measure synchronously, so the editor's
    // first painted frame is already aligned.
    view.coordsAtPos(0);
    viewRef.current = view;
    useEditorsStore.getState().setCmView(view);
    onViewReady?.(view);

    // Store → raw: apply external versions as a minimal diff (plan §2.2).
    const unsubscribe = useDocStore.subscribe((s, prev) => {
      if (s.version === prev.version || s.origin === 'raw' || s.status !== 'open') return;
      const newText = getFullText(s);
      const current = view.state.doc.toString();
      if (current === newText) return; // content-equality short-circuit
      view.dispatch({
        changes: diffToChanges(current, newText),
        annotations: syncAnnotation.of(true),
      });
    });

    if (autoFocus) view.focus();

    return () => {
      unsubscribe();
      onViewReady?.(null);
      const editors = useEditorsStore.getState();
      if (editors.cmView === view) editors.setCmView(null);
      editors.setSelectionText('');
      view.destroy();
      viewRef.current = null;
      useUiStore.getState().setCursor(null);
    };
    // Recreate the editor only when the document identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  // Live-reconfigure line numbers (FR-3.2 toggle). A fresh `lineNumbers()` is a
  // new facet value, so dispatching it tears the gutter down and rebuilds it —
  // skip that when the setting hasn't actually moved since the view was built
  // (every mount, and every document switch, otherwise pays for a rebuild of
  // the gutter it was just created with).
  const appliedLineNumbers = useRef(settingsLineNumbers);
  useEffect(() => {
    if (appliedLineNumbers.current === settingsLineNumbers) return;
    appliedLineNumbers.current = settingsLineNumbers;
    viewRef.current?.dispatch({
      effects: lineNumbersCompartment.reconfigure(settingsLineNumbers ? [lineNumbers()] : []),
    });
  }, [settingsLineNumbers]);

  return (
    <div
      ref={containerRef}
      className="h-full overflow-hidden [&_.cm-editor]:h-full [&_.cm-scroller]:overflow-auto"
      style={{ '--editor-font-size': `${fontSize}px` } as React.CSSProperties}
      data-testid="raw-editor"
    />
  );
}
