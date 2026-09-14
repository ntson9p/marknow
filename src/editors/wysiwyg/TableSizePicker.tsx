import { Table } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';

import { MIN_TABLE_ROWS } from '@/editors/toolbar-commands';
import { cn } from '@/lib/utils';

import { ToolbarButton } from './ToolbarButton';

/** How much grid is offered up front — the Docs/Word picker lands about here. */
const MAX_ROWS = 8;
const MAX_COLS = 10;
/** What the panel opens on: the size the button used to insert outright. */
const DEFAULT_SIZE = { rows: 3, cols: 3 } as const;

/** Hover is a hint, not a click — long enough that sweeping the toolbar is quiet. */
const OPEN_DELAY_MS = 300;
/** Grace for the gap between the button and the panel. */
const CLOSE_DELAY_MS = 200;
const GAP_PX = 6;
const EDGE_PX = 8;

const STEPS: Record<string, { rows: number; cols: number }> = {
  ArrowUp: { rows: -1, cols: 0 },
  ArrowDown: { rows: 1, cols: 0 },
  ArrowLeft: { rows: 0, cols: -1 },
  ArrowRight: { rows: 0, cols: 1 },
};

const clamp = (n: number, low: number, high: number) => Math.min(Math.max(n, low), high);

interface Size {
  rows: number;
  cols: number;
}

interface TableSizePickerProps {
  /** True while the caret sits in a table, like every other toolbar button. */
  active: boolean;
  disabled: boolean;
  /** Insert a table that many rows tall (header included) by that many columns. */
  onPick: (rows: number, cols: number) => void;
}

/**
 * The toolbar's table button and the size grid it opens (FR-5.2): hover or
 * click the button, sweep the grid, click the cell that reads the size you
 * want. It owns its own trigger so the hover, click and keyboard states stay in
 * one place, and the panel is portalled because the toolbar is a single-tab-stop
 * roving group that scrolls under its own overflow on phones — an inline panel
 * would be both clipped and a second tab stop.
 *
 * Rows count the header, so the grid's top row picks `MIN_TABLE_ROWS`: a header
 * with nothing under it is not a table in GFM.
 */
export function TableSizePicker({ active, disabled, onPick }: TableSizePickerProps) {
  const [openedBy, setOpenedBy] = useState<'hover' | 'click' | null>(null);
  const [size, setSize] = useState<Size>(DEFAULT_SIZE);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const timer = useRef(0);
  const focusOnOpen = useRef(false);
  const open = openedBy !== null;

  const clearTimer = () => {
    window.clearTimeout(timer.current);
    timer.current = 0;
  };

  const close = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = 0;
    setOpenedBy(null);
    // Reset here rather than on open: the next open then paints the default
    // size on its first frame instead of flashing the last one picked.
    setSize(DEFAULT_SIZE);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Anchor under the button, clamped to the viewport, measured so the flip-up
  // branch knows the panel's real height. Written straight to the node rather
  // than through state: a state round-trip leaves the panel unplaced (and so
  // unfocusable) for a frame, and React flushes the pending effects — the one
  // that hands the grid its focus included — during exactly that frame.
  useLayoutEffect(() => {
    if (!open) return;
    const button = buttonRef.current;
    const panel = panelRef.current;
    if (!button || !panel) return;

    const place = () => {
      const anchor = button.getBoundingClientRect();
      const { width, height } = panel.getBoundingClientRect();
      const left = clamp(
        anchor.left,
        EDGE_PX,
        Math.max(EDGE_PX, window.innerWidth - width - EDGE_PX),
      );
      const below = anchor.bottom + GAP_PX;
      const top =
        below + height + EDGE_PX > window.innerHeight
          ? Math.max(EDGE_PX, anchor.top - height - GAP_PX)
          : below;
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
    };

    place();
    window.addEventListener('resize', place);
    // Capture: on phones the toolbar is its own horizontal scroller.
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      // Only take focus back when the panel holds it: a hover-opened panel
      // must leave the caret exactly where the writer left it.
      const held = panelRef.current?.contains(document.activeElement) ?? false;
      close();
      if (held) buttonRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open, close]);

  // Keyboard opens land on the grid; mouse opens leave focus in the editor.
  useEffect(() => {
    if (!open || !focusOnOpen.current) return;
    focusOnOpen.current = false;
    panelRef.current?.querySelector<HTMLButtonElement>('button[tabindex="0"]')?.focus();
  }, [open]);

  const scheduleClose = () => {
    clearTimer();
    if (openedBy === 'hover') timer.current = window.setTimeout(close, CLOSE_DELAY_MS);
  };

  const pick = (rows: number, cols: number) => {
    // Close first: the panel is gone before the command hands focus back.
    close();
    onPick(rows, cols);
  };

  const onGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = STEPS[event.key];
    if (!step) return;
    event.preventDefault();
    event.stopPropagation();
    const rows = clamp(size.rows + step.rows, MIN_TABLE_ROWS, MAX_ROWS);
    const cols = clamp(size.cols + step.cols, 1, MAX_COLS);
    setSize({ rows, cols });
    panelRef.current?.querySelector<HTMLButtonElement>(`[data-cell="${rows}x${cols}"]`)?.focus();
  };

  const cells = [];
  for (let row = 1; row <= MAX_ROWS; row++) {
    for (let col = 1; col <= MAX_COLS; col++) {
      // The grid's top row picks the smallest table there is, not a header on
      // its own, so hovering it lights up two rows.
      const rows = Math.max(row, MIN_TABLE_ROWS);
      const filled = row <= size.rows && col <= size.cols;
      cells.push(
        <button
          key={`${row}x${col}`}
          type="button"
          data-cell={`${row}x${col}`}
          // One tab stop: the cell the current size ends on. Row 1 never holds
          // it — row 2 answers for both.
          tabIndex={row === size.rows && col === size.cols ? 0 : -1}
          aria-label={`${rows} rows by ${col} columns`}
          onMouseDown={(event) => event.preventDefault()}
          onPointerEnter={() => setSize({ rows, cols: col })}
          onFocus={() => setSize({ rows, cols: col })}
          onClick={() => pick(rows, col)}
          className={cn(
            'size-4 rounded-[3px] border transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            filled ? 'border-primary bg-primary/30' : 'border-border bg-muted',
          )}
        />,
      );
    }
  }

  return (
    <>
      <ToolbarButton
        ref={buttonRef}
        label="Insert table"
        active={active}
        disabled={disabled}
        expanded={open}
        onPointerEnter={() => {
          if (disabled) return;
          clearTimer();
          // `?? 'hover'` so a tap that already pinned the panel keeps its pin.
          timer.current = window.setTimeout(
            () => setOpenedBy((by) => by ?? 'hover'),
            OPEN_DELAY_MS,
          );
        }}
        onPointerLeave={scheduleClose}
        onClick={(event) => {
          clearTimer();
          if (openedBy === 'click') {
            close();
            return;
          }
          // A click with no pointer behind it is Enter or Space: the writer is
          // on the keyboard, so the grid takes focus. A mouse click leaves it
          // in the editor, where the caret is.
          focusOnOpen.current = event.detail === 0;
          setOpenedBy('click');
        }}
      >
        <Table className="size-4" />
      </ToolbarButton>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label="Table size"
            data-testid="table-size-picker"
            // Top-left in classes, not inline styles, so the layout effect's
            // measured position is the only thing writing `style.top/left`.
            className="fixed left-0 top-0 z-50 select-none rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-md"
            onPointerEnter={clearTimer}
            onPointerLeave={scheduleClose}
            onKeyDown={onGridKeyDown}
            onBlur={(event) => {
              const next = event.relatedTarget as Node | null;
              if (!next) return;
              if (panelRef.current?.contains(next) || buttonRef.current?.contains(next)) return;
              close();
            }}
          >
            <div
              className="grid gap-[3px]"
              style={{ gridTemplateColumns: `repeat(${MAX_COLS}, 1rem)` }}
            >
              {cells}
            </div>
            <div
              data-testid="table-size-label"
              className="mt-2 text-center text-xs tabular-nums text-muted-foreground"
            >
              {size.rows} × {size.cols}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
