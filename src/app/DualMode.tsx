import { useCallback, useState } from 'react';

import type { EditorView } from '@codemirror/view';
import { AlertTriangle } from 'lucide-react';

import { useUiStore } from '@/app/store/ui';
import { SplitPane } from '@/components/SplitPane';
import { useDocStore } from '@/core/document/store';
import { RawEditor } from '@/editors/raw/RawEditor';
import { FindBar, useWysiwygFind } from '@/editors/wysiwyg/FindBar';
import {
  INITIAL_SELECTION_STATE,
  selectionStatesEqual,
  type WysiwygSelectionState,
} from '@/editors/wysiwyg/selection-state';
import { WysiwygEditor } from '@/editors/wysiwyg/WysiwygEditor';
import { WysiwygToolbar } from '@/editors/wysiwyg/Toolbar';
import { useWysiwygRegistration } from '@/editors/wysiwyg/useWysiwygRegistration';
import { useDualScrollSync } from '@/features/scrollsync/useDualScrollSync';

import '@/styles/wysiwyg.css';

function ParseErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="sticky top-0 z-20 flex items-start gap-2 border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
      data-testid="wysiwyg-parse-error"
    >
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <div>
        <div className="font-medium">This document can’t be shown in the rich editor.</div>
        <div className="text-destructive/80">
          Keep editing in the source pane — your text is safe. {message}
        </div>
      </div>
    </div>
  );
}

/**
 * Dual mode (FR-2.4, FR-6): raw source (CodeMirror) on the left, WYSIWYG
 * (Milkdown) on the right, both editing the same `DocumentStore` through the
 * §2 sync protocol. The panes never talk to each other — each is an adapter
 * that pushes with its origin and applies external versions under the three
 * loop-safety guards. A shared toolbar drives whichever pane the cursor was
 * last in: focus tracking picks the target, and the `source` prop routes
 * actions to the CodeMirror pane as markdown text edits.
 */
export function DualMode() {
  const docId = useDocStore((s) => s.docId);
  const dualSplit = useUiStore((s) => s.dualSplit);
  const setDualSplit = useUiStore((s) => s.setDualSplit);

  const { editor, selectionState, onEditorReady, onStateChange, registerScrollEl } =
    useWysiwygRegistration();
  const [parseError, setParseError] = useState<string | null>(null);
  // Ctrl+F targets the WYSIWYG pane only when it's focused; otherwise
  // CodeMirror's own search handles the source pane.
  const find = useWysiwygFind(() => document.activeElement?.closest('.ProseMirror') != null);

  const { setRawView, setWysiwygContainer } = useDualScrollSync();

  // Toolbar target: the last-focused pane. Starts on the rich pane, matching
  // the toolbar's pre-dual-routing behaviour until the user focuses the source.
  const [activePane, setActivePane] = useState<'source' | 'rich'>('rich');
  const [sourceView, setSourceView] = useState<EditorView | null>(null);
  const [sourceState, setSourceState] = useState<WysiwygSelectionState>(INITIAL_SELECTION_STATE);

  const handleRawViewReady = useCallback(
    (view: EditorView | null) => {
      setRawView(view);
      setSourceView(view);
    },
    [setRawView],
  );
  const handleSourceSelectionState = useCallback((next: WysiwygSelectionState) => {
    setSourceState((prev) => (selectionStatesEqual(prev, next) ? prev : next));
  }, []);

  // The right-pane scroll container feeds both the scroll-sync hook and the
  // editors registry (outline jump / find target it).
  const registerRightPane = useCallback(
    (el: HTMLDivElement | null) => {
      setWysiwygContainer(el);
      registerScrollEl(el);
    },
    [setWysiwygContainer, registerScrollEl],
  );

  return (
    <div className="flex h-full flex-col">
      <WysiwygToolbar
        editor={editor}
        state={selectionState}
        source={{ view: sourceView, state: sourceState, active: activePane === 'source' }}
      />
      <div className="min-h-0 flex-1">
        <SplitPane
          ratio={dualSplit}
          onRatioChange={setDualSplit}
          dividerLabel="Resize source and rich editor"
          left={
            <div
              className="h-full"
              onFocus={() => setActivePane('source')}
              data-testid="dual-source-pane"
            >
              <RawEditor
                onViewReady={handleRawViewReady}
                autoFocus={false}
                onSelectionState={handleSourceSelectionState}
              />
            </div>
          }
          right={
            <div
              ref={registerRightPane}
              onFocus={() => setActivePane('rich')}
              className="relative flex h-full flex-col overflow-y-auto border-l bg-background motion-safe:scroll-smooth"
              data-testid="dual-wysiwyg-pane"
            >
              {find.open && editor && (
                <div className="sticky top-0 z-20">
                  <FindBar editor={editor} initialReplace={find.withReplace} onClose={find.close} />
                </div>
              )}
              {parseError && <ParseErrorBanner message={parseError} />}
              {/* Fills the pane rather than sitting in a capped measure: in
                  dual mode the splitter is the width control (FR-2.4), so
                  dragging it has to resize the rich editor. The ~72ch measure
                  belongs to WYSIWYG single mode's centred page (§8.1). */}
              <div
                className="flex w-full grow flex-col px-6"
                // The pane's page is tighter than single mode's centred one.
                style={{ '--mk-page-pad-y': '1.5rem' } as React.CSSProperties}
                data-testid="dual-wysiwyg-page"
              >
                <WysiwygEditor
                  key={docId}
                  onEditorReady={onEditorReady}
                  onStateChange={onStateChange}
                  onParseError={setParseError}
                />
              </div>
            </div>
          }
        />
      </div>
    </div>
  );
}
