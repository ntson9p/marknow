import { useRef, useState, type RefObject } from 'react';

import { MAX_MEASURE_CH, MIN_MEASURE_CH } from '@/app/store/ui';
import { cn } from '@/lib/utils';

interface PageMeasureHandleProps {
  side: 'left' | 'right';
  /** Current page measure in `ch`. */
  measure: number;
  onMeasureChange: (ch: number) => void;
  /** Double-click (or Enter/Space) restores the default measure. */
  onReset: () => void;
  /** The element the measure applies to — its font defines what a `ch` is. */
  pageRef: RefObject<HTMLElement | null>;
}

/** Keyboard step, in `ch`. */
const STEP = 4;

/**
 * Width of one `ch` in the page's own font. Measured against the element the
 * `max-width` is set on, so the px↔ch conversion matches what the browser
 * resolves — a probe rather than an assumed font metric.
 */
function pxPerCh(el: HTMLElement): number {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;height:0;width:100ch;';
  el.appendChild(probe);
  const px = probe.getBoundingClientRect().width / 100;
  probe.remove();
  return px || 8;
}

/** Largest measure that still fits the scroll container, in `ch`. */
function maxFitting(page: HTMLElement, unit: number): number {
  // The measure buys text, not page: the page's own margins are added around it
  // and have to come off the space a measure can claim, as does the 2rem gutter
  // the page floats in.
  const box = getComputedStyle(page);
  const margins = Number.parseFloat(box.paddingLeft) + Number.parseFloat(box.paddingRight);
  const available = (page.parentElement?.clientWidth ?? page.clientWidth) - 32 - margins;
  return Math.min(MAX_MEASURE_CH, Math.floor(available / unit));
}

/**
 * Drag affordance on a page edge that widens/narrows the centred WYSIWYG page.
 *
 * Both edges move together: a centred page can only grow symmetrically, so a
 * pointer delta on one edge is worth twice that in width. Keyboard follows the
 * same physical direction as the drag (outward = wider), with the width itself
 * announced through `aria-valuenow`/`aria-valuetext`.
 */
export function PageMeasureHandle({
  side,
  measure,
  onMeasureChange,
  onReset,
  pageRef,
}: PageMeasureHandleProps) {
  const dragRef = useRef<{ startX: number; startMeasure: number; unit: number; max: number }>(null);
  /** Pointer position while dragging — anchors the readout. */
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);

  /** Measure limits for the current viewport, and the measure clamped into them. */
  const limits = () => {
    const page = pageRef.current;
    const max = page ? maxFitting(page, pxPerCh(page)) : MAX_MEASURE_CH;
    // A measure persisted on a wider window renders capped by `min()`; start
    // from what is actually on screen so the first drag moves the edge at once.
    return { max, from: Math.min(measure, max) };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const page = pageRef.current;
    if (!page || e.button !== 0) return;
    e.preventDefault(); // no text selection while dragging
    const unit = pxPerCh(page);
    const max = maxFitting(page, unit);
    dragRef.current = { startX: e.clientX, startMeasure: Math.min(measure, max), unit, max };
    e.currentTarget.setPointerCapture(e.pointerId);
    setPointer({ x: e.clientX, y: e.clientY });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const outward = (side === 'right' ? 1 : -1) * (e.clientX - drag.startX);
    const next = drag.startMeasure + (2 * outward) / drag.unit;
    onMeasureChange(Math.min(drag.max, Math.max(MIN_MEASURE_CH, next)));
    setPointer({ x: e.clientX, y: e.clientY });
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setPointer(null);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const { max, from } = limits();
    const wider = side === 'right' ? 'ArrowRight' : 'ArrowLeft';
    const narrower = side === 'right' ? 'ArrowLeft' : 'ArrowRight';

    if (e.key === wider) onMeasureChange(Math.min(max, from + STEP));
    else if (e.key === narrower) onMeasureChange(Math.max(MIN_MEASURE_CH, from - STEP));
    else if (e.key === 'Home') onMeasureChange(MIN_MEASURE_CH);
    else if (e.key === 'End') onMeasureChange(max);
    else if (e.key === 'Enter' || e.key === ' ') onReset();
    else return;
    e.preventDefault();
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Content width, ${side} edge`}
      aria-valuenow={measure}
      aria-valuemin={MIN_MEASURE_CH}
      aria-valuemax={MAX_MEASURE_CH}
      aria-valuetext={`${measure} characters wide`}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
      title="Drag to resize · double-click to reset"
      data-testid={`page-measure-${side}`}
      data-dragging={pointer ? 'true' : 'false'}
      className={cn(
        'group absolute inset-y-0 z-10 hidden w-3 cursor-col-resize touch-none outline-none md:block',
        side === 'left' ? '-left-3' : '-right-3',
      )}
    >
      {/* The visible rule: dormant until the edge is hovered, dragged or focused. */}
      <div
        className={cn(
          'absolute inset-y-0 w-0.5 rounded-full bg-transparent',
          'group-hover:bg-primary/50 group-focus-visible:bg-primary',
          'group-data-[dragging=true]:bg-primary',
          'motion-safe:transition-colors',
          side === 'left' ? 'right-0' : 'left-0',
        )}
      />
      {/* Readout pinned to the pointer, not to the page: on a long document the
          grabbed edge is often far from the page's top corner. */}
      {pointer && (
        <div
          aria-hidden
          style={{ left: pointer.x + 14, top: pointer.y - 12 }}
          className="fixed z-50 rounded-full border border-border bg-popover px-2 py-0.5 text-xs tabular-nums text-popover-foreground shadow-sm"
          data-testid="page-measure-readout"
        >
          {measure} ch
        </div>
      )}
    </div>
  );
}
