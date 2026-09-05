import type { Ctx } from '@milkdown/kit/ctx';
import { tableSchema } from '@milkdown/kit/preset/gfm';
import type { Node } from '@milkdown/kit/prose/model';
import type {
  EditorView,
  NodeView,
  NodeViewConstructor,
  ViewMutationRecord,
} from '@milkdown/kit/prose/view';
import { $view } from '@milkdown/kit/utils';

import { icons } from '../plugins/icons';
import {
  closeTableMenu,
  columnMenuItems,
  isTableMenuOpen,
  menuTarget,
  openTableMenu,
  rowMenuItems,
} from './table-menu';
import {
  insertColumn,
  insertRow,
  moveColumn,
  moveRow,
  resolveGrid,
  selectColumn,
  selectRow,
} from './table-ops';

/**
 * Table NodeView (FR-5.7). Replaces the kit's `tableBlock` component so the
 * chrome can be built for GFM rather than for a free-form grid, and so it can
 * live where it does no harm.
 *
 * Layout, and the whole reason for it:
 *
 *   .mk-table            frame — `overflow: visible`, the positioning context
 *     .mk-table-scroll   the only scroll container
 *       table.mk-table-grid > tbody (contentDOM)
 *     .mk-table-chrome   every overlay, absolutely positioned in the *frame*
 *
 * The kit put its handles inside the scroll container. A scroll container's
 * scrollable overflow region includes the transformed border boxes of the
 * absolutely-positioned descendants it contains, so an insert affordance
 * parked on the last column's right edge pushed past the content edge and a
 * table that fitted sprouted a horizontal scrollbar. Nothing here can do that:
 * the chrome is not inside the scroller, so its geometry cannot grow it.
 *
 * Activation follows the header row and the first column: hovering a header
 * cell raises that column's pill, hovering a first-column cell raises that
 * row's pill. Every other cell reaches the same operations by right-click
 * (see `table-context-menu.ts`), so no edit is more than one gesture away.
 */

/** Gap between the table edge and its pill. Mirrored in the CSS bridge. */
const PILL_GAP = 7;

type Axis = 'row' | 'col';

interface Hover {
  row: number;
  col: number;
}

interface DragState {
  axis: Axis;
  from: number;
  to: number;
  /**
   * Trailing edge of every row (bottom) or column (right) along the drag axis,
   * in viewport space. Measured once at `pointerdown` and refreshed on scroll —
   * re-reading it per `pointermove` would be the `getBoundingClientRect` storm
   * the hover path already goes out of its way to avoid.
   */
  edges: number[];
}

/**
 * The row or column whose band contains `coord`, clamped into `[min, max]`.
 *
 * Only the coordinate along the drag axis is consulted, and a pointer past
 * either end resolves to the nearest legal slot. That is what lets the gesture
 * continue anywhere on screen. Resolving the target by hit-testing the pointer
 * instead — `elementFromPoint` — looks equivalent and is not: the grips sit
 * *outside* the grid, a pill-width to its left and a pill-height above it, so a
 * drag that travelled straight along its own axis never entered a cell and
 * resolved to nothing at all.
 */
function bandIndex(edges: number[], coord: number, min: number, max: number) {
  for (let i = min; i < max; i++) {
    const edge = edges[i];
    if (edge !== undefined && coord < edge) return i;
  }
  return max;
}

/** The boundary the dragged row or column would come to rest against. */
function dropBoundary(drag: DragState) {
  return drag.to > drag.from ? drag.to + 1 : drag.to;
}

function button(className: string, icon: string, label: string) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = className;
  el.tabIndex = -1;
  el.setAttribute('aria-label', label);
  el.innerHTML = icon;
  return el;
}

class TableView implements NodeView {
  readonly dom: HTMLElement;
  readonly contentDOM: HTMLElement;

  readonly #ctx: Ctx;
  readonly #view: EditorView;
  readonly #getPos: () => number | undefined;

  readonly #scroll: HTMLElement;
  readonly #grid: HTMLTableElement;
  readonly #chrome: HTMLElement;
  readonly #tip: HTMLElement;
  readonly #indicator: HTMLElement;

  readonly #colPill: HTMLElement;
  readonly #colGrip: HTMLButtonElement;
  readonly #colMore: HTMLButtonElement;
  readonly #colAdd: HTMLButtonElement;

  readonly #rowPill: HTMLElement;
  readonly #rowGrip: HTMLButtonElement;
  readonly #rowMore: HTMLButtonElement;
  readonly #rowAdd: HTMLButtonElement;

  #hover: Hover | null = null;
  #hideTimer: number | null = null;
  #drag: DragState | null = null;
  /** The in-flight drag's document scroll listener, so `destroy` can drop it. */
  #dragScroll: (() => void) | null = null;
  #altHeld = false;
  /** Which add button the pointer is on, so Alt can relabel it live. */
  #addHover: Axis | null = null;

  constructor(ctx: Ctx, view: EditorView, getPos: () => number | undefined) {
    this.#ctx = ctx;
    this.#view = view;
    this.#getPos = getPos;

    this.dom = document.createElement('div');
    this.dom.className = 'mk-table';

    this.#scroll = document.createElement('div');
    this.#scroll.className = 'mk-table-scroll';

    this.#grid = document.createElement('table');
    this.#grid.className = 'mk-table-grid';

    this.contentDOM = document.createElement('tbody');
    this.#grid.appendChild(this.contentDOM);
    this.#scroll.appendChild(this.#grid);

    this.#chrome = document.createElement('div');
    this.#chrome.className = 'mk-table-chrome';
    this.#chrome.contentEditable = 'false';

    this.#indicator = document.createElement('div');
    this.#indicator.className = 'mk-table-indicator';
    this.#indicator.hidden = true;

    this.#tip = document.createElement('div');
    this.#tip.className = 'mk-table-tip';
    this.#tip.setAttribute('role', 'tooltip');
    this.#tip.hidden = true;

    this.#colGrip = button('mk-pill-grip', icons.gripHorizontal, 'Select or drag column');
    this.#colMore = button('mk-pill-more', icons.chevronDown, 'Column options');
    this.#colMore.setAttribute('aria-haspopup', 'menu');
    this.#colMore.setAttribute('aria-expanded', 'false');
    this.#colAdd = button('mk-pill-add', icons.plus, 'Insert column');
    this.#colPill = document.createElement('div');
    this.#colPill.className = 'mk-table-pill mk-table-pill-col';
    this.#colPill.hidden = true;
    this.#colPill.append(this.#colGrip, this.#colMore, this.#colAdd);

    this.#rowGrip = button('mk-pill-grip', icons.grip, 'Select or drag row');
    this.#rowMore = button('mk-pill-more', icons.chevronDown, 'Row options');
    this.#rowMore.setAttribute('aria-haspopup', 'menu');
    this.#rowMore.setAttribute('aria-expanded', 'false');
    this.#rowAdd = button('mk-pill-add', icons.plus, 'Insert row');
    this.#rowPill = document.createElement('div');
    this.#rowPill.className = 'mk-table-pill mk-table-pill-row';
    this.#rowPill.hidden = true;
    this.#rowPill.append(this.#rowGrip, this.#rowMore, this.#rowAdd);

    this.#chrome.append(this.#indicator, this.#colPill, this.#rowPill, this.#tip);
    this.dom.append(this.#scroll, this.#chrome);

    this.#bind();
  }

  /* ---------- position helpers ---------- */

  get #tablePos() {
    return this.#getPos();
  }

  #frameRect() {
    return this.dom.getBoundingClientRect();
  }

  #rows() {
    return Array.from(this.contentDOM.children) as HTMLTableRowElement[];
  }

  #cell(row: number, col: number): HTMLElement | null {
    const tr = this.#rows()[row];
    return (tr?.children[col] as HTMLElement | undefined) ?? null;
  }

  #cellIndex(target: EventTarget | null): Hover | null {
    if (!(target instanceof globalThis.Node)) return null;
    const el = target instanceof Element ? target : target.parentElement;
    const cell = el?.closest('th, td');
    if (!cell || !this.contentDOM.contains(cell)) return null;
    const tr = cell.parentElement as HTMLTableRowElement | null;
    if (!tr) return null;
    // GFM has no row or column spans, so DOM order is the logical index.
    return {
      row: this.#rows().indexOf(tr),
      col: Array.prototype.indexOf.call(tr.children, cell),
    };
  }

  /** Trailing edges of the rows or columns, in index order, in viewport space. */
  #measureEdges(axis: Axis): number[] {
    if (axis === 'row') return this.#rows().map((tr) => tr.getBoundingClientRect().bottom);
    const header = this.#rows()[0];
    if (!header) return [];
    return Array.from(header.children).map((cell) => cell.getBoundingClientRect().right);
  }

  /* ---------- chrome visibility ---------- */

  #show(hover: Hover) {
    this.#cancelHide();
    // Re-measuring on every pointermove would be a `getBoundingClientRect`
    // storm; the chrome only moves when the hovered cell changes.
    if (this.#hover && this.#hover.row === hover.row && this.#hover.col === hover.col) return;
    this.#hover = hover;
    this.#layout();
  }

  #layout() {
    const hover = this.#hover;
    const grid = this.#gridInfo();
    if (!hover || !grid) {
      this.#hideChrome();
      return;
    }

    const frame = this.#frameRect();

    // The column pill answers to the header row; it is anchored over the
    // header cell whether or not that is the cell being hovered.
    if (hover.row === 0) {
      const header = this.#cell(0, hover.col);
      if (header) {
        this.#colPill.hidden = false;
        const rect = header.getBoundingClientRect();
        const width = this.#colPill.offsetWidth;
        const x = rect.left - frame.left + rect.width / 2 - width / 2;
        this.#colPill.style.left = `${Math.max(0, Math.min(x, frame.width - width))}px`;
        this.#colPill.style.top = `${rect.top - frame.top - this.#colPill.offsetHeight - PILL_GAP}px`;
      }
    } else if (!this.#isMenuOwner(this.#colMore)) {
      this.#colPill.hidden = true;
    }

    // The row pill answers to the first column, and the header row gets only
    // its insert button — a GFM header row cannot move, go, or be duplicated.
    if (hover.col === 0) {
      const cell = this.#cell(hover.row, 0);
      if (cell) {
        const headerRow = hover.row === 0;
        this.#rowPill.classList.toggle('is-header-row', headerRow);
        this.#rowGrip.hidden = headerRow;
        this.#rowMore.hidden = headerRow;
        this.#rowPill.hidden = false;
        const rect = cell.getBoundingClientRect();
        const width = this.#rowPill.offsetWidth;
        this.#rowPill.style.left = `${rect.left - frame.left - width - PILL_GAP - 1}px`;
        this.#rowPill.style.top = `${rect.top - frame.top + rect.height / 2 - this.#rowPill.offsetHeight / 2}px`;
      }
    } else if (!this.#isMenuOwner(this.#rowMore)) {
      this.#rowPill.hidden = true;
    }
  }

  #isMenuOwner(el: HTMLElement) {
    return isTableMenuOpen() && el.getAttribute('aria-expanded') === 'true';
  }

  #hideChrome() {
    if (isTableMenuOpen() || this.#drag) return;
    this.#hover = null;
    this.#colPill.hidden = true;
    this.#rowPill.hidden = true;
    this.#hideTip();
    this.#hideIndicator();
  }

  #scheduleHide() {
    this.#cancelHide();
    this.#hideTimer = window.setTimeout(() => {
      this.#hideTimer = null;
      this.#hideChrome();
    }, 250);
  }

  #cancelHide() {
    if (this.#hideTimer === null) return;
    window.clearTimeout(this.#hideTimer);
    this.#hideTimer = null;
  }

  /* ---------- tooltip ---------- */

  #showTip(anchor: HTMLElement, label: string, hint?: string) {
    this.#tip.hidden = false;
    this.#tip.innerHTML = hint ? `${label}<span class="mk-tip-hint">${hint}</span>` : label;
    const frame = this.#frameRect();
    const rect = anchor.getBoundingClientRect();
    const x = rect.left - frame.left + rect.width / 2 - this.#tip.offsetWidth / 2;
    this.#tip.style.left = `${x}px`;
    this.#tip.style.top = `${rect.top - frame.top - this.#tip.offsetHeight - 6}px`;
  }

  #hideTip() {
    this.#tip.hidden = true;
  }

  /* ---------- insertion / drop indicator ---------- */

  /**
   * Paint the boundary an insert or a drop would land on. `index` counts
   * boundaries, so it runs one past the last row/column.
   */
  #showIndicator(axis: Axis, index: number) {
    const grid = this.#gridInfo();
    if (!grid) return;
    const frame = this.#frameRect();
    const gridRect = this.#grid.getBoundingClientRect();
    this.#indicator.hidden = false;

    if (axis === 'col') {
      const last = index >= grid.cols;
      const ref = this.#cell(0, last ? grid.cols - 1 : index);
      if (!ref) return;
      const rect = ref.getBoundingClientRect();
      const x = (last ? rect.right : rect.left) - frame.left;
      this.#indicator.style.left = `${Math.max(0, Math.min(x - 1, frame.width - 2))}px`;
      this.#indicator.style.top = `${gridRect.top - frame.top}px`;
      this.#indicator.style.width = '2px';
      this.#indicator.style.height = `${gridRect.height}px`;
      return;
    }

    const last = index >= grid.rows;
    const ref = this.#cell(last ? grid.rows - 1 : index, 0);
    if (!ref) return;
    const rect = ref.getBoundingClientRect();
    this.#indicator.style.left = `${gridRect.left - frame.left}px`;
    this.#indicator.style.top = `${(last ? rect.bottom : rect.top) - frame.top - 1}px`;
    this.#indicator.style.width = `${gridRect.width}px`;
    this.#indicator.style.height = '2px';
  }

  #hideIndicator() {
    this.#indicator.hidden = true;
  }

  /* ---------- insert targets ---------- */

  /** Boundary index a click on the column `+` would insert at. */
  #colTarget() {
    if (!this.#hover) return null;
    return this.#altHeld ? this.#hover.col : this.#hover.col + 1;
  }

  /** Boundary index a click on the row `+` would insert at. */
  #rowTarget() {
    if (!this.#hover) return null;
    // Nothing goes above the header row, so its `+` always means "below".
    if (this.#hover.row === 0) return 1;
    return this.#altHeld ? this.#hover.row : this.#hover.row + 1;
  }

  #syncAddHover() {
    if (!this.#addHover || !this.#hover) return;
    if (this.#addHover === 'col') {
      const target = this.#colTarget();
      if (target === null) return;
      this.#showTip(
        this.#colAdd,
        this.#altHeld ? 'Insert 1 column left' : 'Insert 1 column right',
        this.#altHeld ? undefined : 'Alt for left',
      );
      this.#showIndicator('col', target);
      return;
    }
    const target = this.#rowTarget();
    if (target === null) return;
    const headerRow = this.#hover.row === 0;
    this.#showTip(
      this.#rowAdd,
      this.#altHeld && !headerRow ? 'Insert 1 row above' : 'Insert 1 row below',
      headerRow || this.#altHeld ? undefined : 'Alt for above',
    );
    this.#showIndicator('row', target);
  }

  #gridInfo() {
    const pos = this.#tablePos;
    if (pos === undefined) return null;
    return resolveGrid(this.#view, pos);
  }

  /* ---------- menus ---------- */

  #openMenu(kind: 'row' | 'col', owner: HTMLElement) {
    const pos = this.#tablePos;
    if (pos === undefined) return;
    if (this.#isMenuOwner(owner)) {
      closeTableMenu();
      return;
    }
    const target = menuTarget(this.#ctx, this.#view, pos);
    if (!target || !this.#hover) return;
    // The menu answers the question the tooltip was asking.
    this.#hideTip();
    this.#hideIndicator();

    const items =
      kind === 'col'
        ? columnMenuItems(target, this.#hover.col)
        : rowMenuItems(target, this.#hover.row);

    owner.setAttribute('aria-expanded', 'true');
    openTableMenu({
      items,
      anchor: owner.getBoundingClientRect(),
      label: kind === 'col' ? 'Column options' : 'Row options',
      onClose: () => {
        owner.setAttribute('aria-expanded', 'false');
        // The menu takes focus while it is open, so hand it back.
        this.#view.focus();
        this.#scheduleHide();
      },
    });
  }

  /* ---------- drag to reorder ---------- */

  #beginDrag(axis: Axis, event: PointerEvent, grip: HTMLElement) {
    const pos = this.#tablePos;
    if (pos === undefined || !this.#hover) return;
    event.preventDefault();

    const from = axis === 'col' ? this.#hover.col : this.#hover.row;
    if (axis === 'row' && from === 0) return;

    // Measuring ahead of the select below is safe: `.selectedCell` paints a
    // background and cannot reflow the grid.
    this.#drag = { axis, from, to: from, edges: this.#measureEdges(axis) };
    this.dom.classList.add('is-dragging');
    grip.setPointerCapture(event.pointerId);
    this.#hideTip();

    if (axis === 'col') selectColumn(this.#ctx, this.#view, pos, from);
    else selectRow(this.#ctx, this.#view, pos, from);

    const onMove = (moveEvent: PointerEvent) => {
      const drag = this.#drag;
      if (!drag) return;
      const grid = this.#gridInfo();
      if (!grid) return;
      // Row 0 is the header: a row may pass over it but not come to rest there.
      drag.to =
        drag.axis === 'col'
          ? bandIndex(drag.edges, moveEvent.clientX, 0, grid.cols - 1)
          : bandIndex(drag.edges, moveEvent.clientY, 1, grid.rows - 1);
      this.#showIndicator(drag.axis, dropBoundary(drag));
    };

    // The edges are viewport-space, so any scroll beneath the pointer — the
    // table's own scroller, the page, any ancestor — invalidates them. Capture
    // phase because `scroll` does not bubble.
    const onScroll = () => {
      const drag = this.#drag;
      if (!drag) return;
      drag.edges = this.#measureEdges(drag.axis);
      this.#showIndicator(drag.axis, dropBoundary(drag));
    };

    const onUp = () => {
      const drag = this.#drag;
      this.#drag = null;
      this.dom.classList.remove('is-dragging');
      this.#hideIndicator();
      // `pointercancel` has already dropped the capture, and releasing one that
      // is not held throws.
      if (grip.hasPointerCapture(event.pointerId)) grip.releasePointerCapture(event.pointerId);
      grip.removeEventListener('pointermove', onMove);
      grip.removeEventListener('pointerup', onUp);
      grip.removeEventListener('pointercancel', onUp);
      document.removeEventListener('scroll', onScroll, true);
      this.#dragScroll = null;
      const tablePos = this.#tablePos;
      if (!drag || tablePos === undefined || drag.to === drag.from) return;
      if (drag.axis === 'col') moveColumn(this.#ctx, this.#view, tablePos, drag.from, drag.to);
      else moveRow(this.#ctx, this.#view, tablePos, drag.from, drag.to);
    };

    grip.addEventListener('pointermove', onMove);
    grip.addEventListener('pointerup', onUp);
    grip.addEventListener('pointercancel', onUp);
    // The grip's own listeners die with the detached element; this one outlives
    // the NodeView, so `destroy` has to be able to find it.
    this.#dragScroll = onScroll;
    document.addEventListener('scroll', onScroll, true);
  }

  /* ---------- wiring ---------- */

  #bind() {
    this.dom.addEventListener('pointermove', (event) => {
      if (this.#drag) return;
      const cell = this.#cellIndex(event.target);
      // Moving off the cells and onto a pill must not dismiss it.
      if (cell) this.#show(cell);
      else this.#cancelHide();
    });
    this.dom.addEventListener('pointerleave', () => this.#scheduleHide());
    // A horizontally scrolled table moves its cells out from under the pills.
    this.#scroll.addEventListener('scroll', () => {
      if (this.#hover) this.#layout();
    });

    // `pointerdown` both selects and arms the drag, so a plain click on a grip
    // still selects — no separate click handler, which would select twice.
    this.#colGrip.addEventListener('pointerdown', (event) =>
      this.#beginDrag('col', event, this.#colGrip),
    );
    this.#rowGrip.addEventListener('pointerdown', (event) =>
      this.#beginDrag('row', event, this.#rowGrip),
    );

    this.#colMore.addEventListener('click', () => this.#openMenu('col', this.#colMore));
    this.#rowMore.addEventListener('click', () => this.#openMenu('row', this.#rowMore));

    this.#colAdd.addEventListener('click', () => {
      const pos = this.#tablePos;
      const target = this.#colTarget();
      if (pos === undefined || target === null) return;
      this.#hideTip();
      this.#hideIndicator();
      this.#addHover = null;
      insertColumn(this.#ctx, this.#view, pos, target);
    });
    this.#rowAdd.addEventListener('click', () => {
      const pos = this.#tablePos;
      const target = this.#rowTarget();
      if (pos === undefined || target === null) return;
      this.#hideTip();
      this.#hideIndicator();
      this.#addHover = null;
      insertRow(this.#ctx, this.#view, pos, target);
    });

    const tipOnly = (el: HTMLElement, label: string) => {
      el.addEventListener('pointerenter', () => this.#showTip(el, label));
      el.addEventListener('pointerleave', () => this.#hideTip());
    };
    tipOnly(this.#colGrip, 'Select or drag column');
    tipOnly(this.#colMore, 'Column options');
    tipOnly(this.#rowGrip, 'Select or drag row');
    tipOnly(this.#rowMore, 'Row options');

    this.#colAdd.addEventListener('pointerenter', () => {
      this.#addHover = 'col';
      this.#syncAddHover();
    });
    this.#rowAdd.addEventListener('pointerenter', () => {
      this.#addHover = 'row';
      this.#syncAddHover();
    });
    for (const el of [this.#colAdd, this.#rowAdd]) {
      el.addEventListener('pointerleave', () => {
        this.#addHover = null;
        this.#hideTip();
        this.#hideIndicator();
      });
    }

    window.addEventListener('keydown', this.#onKey);
    window.addEventListener('keyup', this.#onKey);
    window.addEventListener('blur', this.#onWindowBlur);
  }

  #onKey = (event: KeyboardEvent) => {
    const held = event.type === 'keydown' && event.key === 'Alt';
    if (event.key !== 'Alt' || held === this.#altHeld) return;
    this.#altHeld = held;
    this.#syncAddHover();
  };

  #onWindowBlur = () => {
    this.#altHeld = false;
  };

  /* ---------- NodeView contract ---------- */

  update(node: Node) {
    if (node.type.name !== 'table') return false;
    // Cells may have moved under the chrome; re-measure what is on screen.
    if (this.#hover) requestAnimationFrame(() => this.#layout());
    return true;
  }

  ignoreMutation(mutation: ViewMutationRecord) {
    if ((mutation.type as unknown) === 'selection') return false;
    return !this.contentDOM.contains(mutation.target);
  }

  stopEvent(event: Event) {
    return event.target instanceof globalThis.Node && this.#chrome.contains(event.target);
  }

  destroy() {
    window.removeEventListener('keydown', this.#onKey);
    window.removeEventListener('keyup', this.#onKey);
    window.removeEventListener('blur', this.#onWindowBlur);
    // A view torn down mid-drag never sees its own `pointerup`.
    if (this.#dragScroll) document.removeEventListener('scroll', this.#dragScroll, true);
    this.#dragScroll = null;
    this.#drag = null;
    this.#cancelHide();
    closeTableMenu();
  }
}

export const tableView = $view(tableSchema.node, (ctx): NodeViewConstructor => {
  return (_node, view, getPos) => new TableView(ctx, view, getPos);
});
