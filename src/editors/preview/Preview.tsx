import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

import { useDocStore } from '@/core/document/store';
import { renderMermaidBlocks } from '@/editors/preview/mermaid';
import { useResolvedTheme } from '@/features/settings/theme';

const DEBOUNCE_MS = 200; // FR-4.2: ≤ 250 ms after typing stops
/** Gap between the button and the code block's top-right corner. */
const COPY_INSET_PX = 8;
/** How long the button reports the outcome before returning to its label. */
const COPY_FEEDBACK_MS = 1200;

/** The hovered code block, with its corner measured against the overlay box. */
interface CopyTarget {
  pre: HTMLElement;
  /** Render the measurement belongs to; a newer one invalidates the corner. */
  html: string;
  top: number;
  right: number;
}

const COPY_LABEL = { idle: 'Copy', copied: 'Copied', failed: 'Failed' } as const;

interface PreviewProps {
  /** Exposes the scroll container (scroll sync). */
  onContainerReady?: (el: HTMLDivElement | null) => void;
  /** Called after each committed render (scroll-sync anchor invalidation). */
  onRendered?: () => void;
}

/**
 * Live preview (FR-4) via the shared unified pipeline (lazy chunk). The HTML
 * set below is sanitized by rehype-sanitize inside the pipeline — that is the
 * security boundary (§7).
 */
export function Preview({ onContainerReady, onRendered }: PreviewProps) {
  const body = useDocStore((s) => s.body);
  const theme = useResolvedTheme();
  const [html, setHtml] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const copyButtonRef = useRef<HTMLButtonElement>(null);
  const renderSeq = useRef(0);
  const firstRender = useRef(true);

  const [copyTarget, setCopyTarget] = useState<CopyTarget | null>(null);
  const [copyState, setCopyState] = useState<keyof typeof COPY_LABEL>('idle');
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const seq = ++renderSeq.current;
    const run = async () => {
      const { renderMarkdown } = await import('@/core/markdown/render');
      const rendered = await renderMarkdown(body);
      if (seq !== renderSeq.current) return; // stale
      setHtml(rendered);
    };
    if (firstRender.current) {
      firstRender.current = false;
      void run();
      return;
    }
    const timer = setTimeout(run, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [body]);

  // Post-process mermaid fences after each committed render.
  useEffect(() => {
    if (html === null || !articleRef.current) return;
    onRendered?.();
    void renderMermaidBlocks(articleRef.current, theme === 'dark').then(() => onRendered?.());
  }, [html, theme, onRendered]);

  useEffect(() => () => clearTimeout(copyTimer.current), []);

  useEffect(() => {
    onContainerReady?.(containerRef.current);
    return () => onContainerReady?.(null);
  }, [onContainerReady]);

  const trackHoveredBlock = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const overlay = overlayRef.current;
      const target = event.target as HTMLElement | null;
      // `html` is non-null wherever the overlay exists; this narrows the type.
      if (!overlay || !target || html === null) return;
      // Reaching for the button must not dismiss the block it belongs to.
      if (copyButtonRef.current?.contains(target)) return;

      // Mermaid fences are replaced by rendered SVG before this can see them,
      // so a diagram is never offered a Copy button — which is right, there is
      // no code left to copy.
      const pre = target.closest('pre');
      if (!pre) {
        if (copyTarget) setCopyTarget(null);
        return;
      }
      if (copyTarget?.pre === pre && copyTarget.html === html) return; // unchanged

      const block = pre.getBoundingClientRect();
      const box = overlay.getBoundingClientRect();
      setCopyTarget({
        pre,
        html,
        // Measured against the overlay, which scrolls with the article, so the
        // button stays pinned to its block as the column scrolls.
        top: block.top - box.top + COPY_INSET_PX,
        right: box.right - block.right + COPY_INSET_PX,
      });
      setCopyState('idle');
    },
    [copyTarget, html],
  );

  // A re-render replaces every block, so a corner measured against an older
  // one is meaningless. Derive the button away rather than resetting state
  // after the fact — the next hover measures afresh.
  const activeTarget = copyTarget?.html === html ? copyTarget : null;

  const copyHoveredBlock = useCallback(() => {
    const pre = activeTarget?.pre;
    if (!pre) return;
    const settle = (state: keyof typeof COPY_LABEL) => {
      setCopyState(state);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopyState('idle'), COPY_FEEDBACK_MS);
    };

    // Absent outside a secure context — report it rather than throwing.
    const clipboard = navigator.clipboard as Clipboard | undefined;
    if (!clipboard) {
      settle('failed');
      return;
    }
    // A rendered fence always ends in a newline that isn't part of the code as
    // shown; copying it would paste a stray blank line. Only that one goes.
    const code = (pre.querySelector('code')?.textContent ?? pre.textContent ?? '').replace(
      /\n$/,
      '',
    );
    void clipboard.writeText(code).then(
      () => settle('copied'),
      () => settle('failed'),
    );
  }, [activeTarget]);

  return (
    <div
      ref={containerRef}
      className="h-full overflow-y-auto bg-background"
      data-testid="preview"
      aria-label="Preview"
    >
      {html === null ? (
        <div className="flex h-24 items-center justify-center text-muted-foreground">
          <Loader2 className="size-5 animate-spin" aria-label="Rendering preview" />
        </div>
      ) : (
        // Positioning context for the hover Copy button. The button is a
        // sibling of the article, never a child: the sanitized HTML stays
        // untouched, `pre` keeps its own horizontal scroll to itself, and
        // because the button is out of flow the document never reflows when it
        // appears. Nesting is invisible to scroll sync, which reads anchor
        // positions through `getBoundingClientRect` (see table-scroll.ts).
        <div
          ref={overlayRef}
          className="relative"
          onMouseOver={trackHoveredBlock}
          onMouseLeave={() => setCopyTarget(null)}
        >
          <article
            ref={articleRef}
            // Fills its column rather than sitting in a capped measure: here the
            // splitter is the width control (FR-2.4), so dragging it has to
            // resize the rendered document. The ~72ch measure belongs to WYSIWYG
            // single mode's centred page (§8.1), which has no divider to size the
            // text with.
            className="md-doc w-full px-8 py-6"
            data-testid="preview-doc"
            // Safe by design: `html` comes from the shared pipeline which runs
            // rehype-sanitize (allowlist schema) — see core/markdown/render.ts.
            dangerouslySetInnerHTML={{ __html: html }}
          />
          {activeTarget && (
            <button
              ref={copyButtonRef}
              type="button"
              onClick={copyHoveredBlock}
              style={{ top: activeTarget.top, right: activeTarget.right }}
              className="absolute z-10 rounded-md border border-border bg-background px-2 py-0.5 text-xs text-muted-foreground shadow-sm transition-colors select-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              title="Copy code"
              data-testid="preview-copy-code"
            >
              {COPY_LABEL[copyState]}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
