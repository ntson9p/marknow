import { useRef } from 'react';

import { useIsSmallScreen } from '@/app/useMediaQuery';
import { useUiStore } from '@/app/store/ui';
import { PageMeasureHandle } from '@/components/PageMeasureHandle';
import { useDocStore } from '@/core/document/store';
import { FindBar, useWysiwygFind } from '@/editors/wysiwyg/FindBar';
import { WysiwygToolbar } from '@/editors/wysiwyg/Toolbar';
import { WysiwygEditor } from '@/editors/wysiwyg/WysiwygEditor';
import { useWysiwygRegistration } from '@/editors/wysiwyg/useWysiwygRegistration';

import '@/styles/wysiwyg.css';

/**
 * WYSIWYG single mode (§8.1): fixed toolbar + centered Docs-like page.
 * The page measure defaults to 72ch and is user-resizable by dragging either
 * edge (persisted per device, FR-2.3). It is the width of the text itself: the
 * page's 1in margins (`--mk-page-margin-x`, wysiwyg.css) are added around it,
 * so the card comes out a Google Docs sheet — 6.5in of column between two 1in
 * margins. `min()` keeps the whole thing inside the viewport whatever was
 * persisted, so a narrow window never overflows.
 */
export function WysiwygMode() {
  const docId = useDocStore((s) => s.docId);
  const measure = useUiStore((s) => s.wysiwygMeasure);
  const setMeasure = useUiStore((s) => s.setWysiwygMeasure);
  const resetMeasure = useUiStore((s) => s.resetWysiwygMeasure);
  const isSmall = useIsSmallScreen();
  const pageRef = useRef<HTMLDivElement>(null);

  const { editor, selectionState, onEditorReady, onStateChange, registerScrollEl } =
    useWysiwygRegistration();
  const find = useWysiwygFind(() => true);

  return (
    <div className="flex h-full flex-col">
      <WysiwygToolbar editor={editor} state={selectionState} />
      {find.open && editor && (
        <FindBar editor={editor} initialReplace={find.withReplace} onClose={find.close} />
      )}
      <div
        ref={registerScrollEl}
        className="min-h-0 flex-1 overflow-y-auto bg-muted/30 motion-safe:scroll-smooth"
      >
        <div
          ref={pageRef}
          style={{
            maxWidth: `min(calc(${measure}ch + 2 * var(--mk-page-margin-x)), calc(100% - 2rem))`,
          }}
          className="wysiwyg-page relative mx-auto my-8 flex min-h-[70%] w-full flex-col rounded-lg border border-border/60 bg-background shadow-sm"
          data-testid="wysiwyg-page"
        >
          {/* Resize affordances live in the gutter, clear of the text (§8.2:
              small screens are full-width single pane, so no handles there). */}
          {!isSmall &&
            (['left', 'right'] as const).map((side) => (
              <PageMeasureHandle
                key={side}
                side={side}
                measure={measure}
                onMeasureChange={setMeasure}
                onReset={resetMeasure}
                pageRef={pageRef}
              />
            ))}
          <WysiwygEditor key={docId} onEditorReady={onEditorReady} onStateChange={onStateChange} />
        </div>
      </div>
    </div>
  );
}
