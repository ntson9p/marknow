import type { Ctx } from '@milkdown/kit/ctx';
import type { EditorView } from '@milkdown/kit/prose/view';

import { icons } from '../plugins/icons';
import {
  alignColumn,
  alignmentOf,
  canDeleteColumn,
  canDeleteRow,
  deleteColumn,
  deleteRow,
  deleteTable,
  duplicateColumn,
  duplicateRow,
  insertColumn,
  insertRow,
  moveColumn,
  moveRow,
  resolveGrid,
  selectWholeTable,
  type TableGrid,
} from './table-ops';

/**
 * The one menu behind every table control (FR-5.7): the pill chevrons, the
 * corner square, and the right-click context menu all open this.
 *
 * It mounts on `document.body` with `position: fixed` rather than inside the
 * NodeView. Two reasons: a popover anchored inside the table's scroll
 * container is the exact mistake that gave the old chrome its phantom
 * scrollbar, and a body-level element is reachable from the context-menu
 * plugin, which has no NodeView to hang off.
 */

export interface MenuItem {
  label: string;
  icon: string;
  run: () => void;
  disabled?: boolean;
  /** Renders as a radio item; `true` shows the check. */
  checked?: boolean;
  danger?: boolean;
  /** Draw a divider above this item. */
  group?: boolean;
}

interface OpenOptions {
  items: MenuItem[];
  /** Viewport rect the menu is placed against. */
  anchor: DOMRect;
  /** Preferred side; the menu still flips when it would leave the viewport. */
  placement?: 'below' | 'right';
  label: string;
  onClose?: () => void;
}

let host: HTMLElement | null = null;
let buttons: HTMLButtonElement[] = [];
let onCloseHook: (() => void) | undefined;
let focusIndex = -1;

function ensureHost(): HTMLElement {
  if (host?.isConnected) return host;
  const el = document.createElement('div');
  el.className = 'mk-table-menu';
  el.setAttribute('role', 'menu');
  el.hidden = true;
  document.body.appendChild(el);
  host = el;
  return el;
}

export function isTableMenuOpen() {
  return !!host && !host.hidden;
}

export function closeTableMenu() {
  if (!host || host.hidden) return;
  host.hidden = true;
  host.innerHTML = '';
  buttons = [];
  focusIndex = -1;
  const hook = onCloseHook;
  onCloseHook = undefined;
  document.removeEventListener('pointerdown', onDocumentPointerDown, true);
  document.removeEventListener('keydown', onDocumentKeyDown, true);
  window.removeEventListener('resize', closeTableMenu);
  window.removeEventListener('scroll', closeTableMenu, true);
  hook?.();
}

function onDocumentPointerDown(event: PointerEvent) {
  if (host && event.target instanceof Node && host.contains(event.target)) return;
  closeTableMenu();
}

function moveFocus(delta: number) {
  const enabled = buttons.filter((b) => !b.disabled);
  if (enabled.length === 0) return;
  const focused = focusIndex >= 0 ? (buttons[focusIndex] as HTMLButtonElement) : undefined;
  const current = focused ? enabled.indexOf(focused) : -1;
  // From nowhere, ArrowDown lands on the first item and ArrowUp on the last.
  const index = current < 0 ? (delta > 0 ? 0 : enabled.length - 1) : current + delta;
  const next = enabled[(index + enabled.length) % enabled.length];
  if (!next) return;
  focusIndex = buttons.indexOf(next);
  next.focus();
}

function onDocumentKeyDown(event: KeyboardEvent) {
  if (!isTableMenuOpen()) return;
  switch (event.key) {
    case 'Escape':
      event.preventDefault();
      event.stopPropagation();
      closeTableMenu();
      break;
    case 'ArrowDown':
      event.preventDefault();
      moveFocus(1);
      break;
    case 'ArrowUp':
      event.preventDefault();
      moveFocus(-1);
      break;
    case 'Home':
      event.preventDefault();
      focusIndex = -1;
      moveFocus(1);
      break;
    case 'End':
      event.preventDefault();
      focusIndex = 0;
      moveFocus(-1);
      break;
    case 'Tab':
      closeTableMenu();
      break;
    default:
      break;
  }
}

export function openTableMenu({ items, anchor, placement = 'below', label, onClose }: OpenOptions) {
  closeTableMenu();
  const el = ensureHost();
  el.setAttribute('aria-label', label);
  onCloseHook = onClose;

  for (const item of items) {
    if (item.group && el.childElementCount > 0) el.appendChild(document.createElement('hr'));
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', item.checked === undefined ? 'menuitem' : 'menuitemradio');
    if (item.checked !== undefined) button.setAttribute('aria-checked', String(item.checked));
    if (item.danger) button.classList.add('danger');
    button.disabled = !!item.disabled;
    button.innerHTML = `${item.icon}<span>${item.label}</span>${
      item.checked === undefined ? '' : `<span class="mk-check">${icons.check}</span>`
    }`;
    button.addEventListener('click', () => {
      closeTableMenu();
      item.run();
    });
    el.appendChild(button);
    buttons.push(button);
  }

  // Measure before placing: the menu has to be laid out to know its own size.
  el.hidden = false;
  el.style.left = '0px';
  el.style.top = '0px';
  const { width, height } = el.getBoundingClientRect();
  const margin = 8;

  let left = placement === 'right' ? anchor.right + 6 : anchor.left;
  let top = placement === 'right' ? anchor.top : anchor.bottom + 6;
  if (left + width > window.innerWidth - margin) {
    left = placement === 'right' ? anchor.left - width - 6 : window.innerWidth - width - margin;
  }
  if (top + height > window.innerHeight - margin) {
    top = placement === 'right' ? window.innerHeight - height - margin : anchor.top - height - 6;
  }
  el.style.left = `${Math.max(margin, left)}px`;
  el.style.top = `${Math.max(margin, top)}px`;

  document.addEventListener('pointerdown', onDocumentPointerDown, true);
  document.addEventListener('keydown', onDocumentKeyDown, true);
  window.addEventListener('resize', closeTableMenu);
  window.addEventListener('scroll', closeTableMenu, true);

  // A `role="menu"` that never takes focus leaves keystrokes going into the
  // document behind it — and Shift+F10 has no other way in. `onClose` hands
  // focus back to the editor.
  moveFocus(1);
}

/* ---------- item sets ---------- */

interface Target {
  ctx: Ctx;
  view: EditorView;
  tablePos: number;
  grid: TableGrid;
}

function alignmentItems({ ctx, view, tablePos }: Target, col: number): MenuItem[] {
  const current = alignmentOf(view, tablePos, col);
  return (
    [
      ['left', 'Align left', icons.alignLeft],
      ['center', 'Align center', icons.alignCenter],
      ['right', 'Align right', icons.alignRight],
    ] as const
  ).map(([alignment, label, icon]) => ({
    label,
    icon,
    checked: current === alignment,
    run: () => alignColumn(ctx, view, tablePos, col, alignment),
  }));
}

export function columnMenuItems(target: Target, col: number): MenuItem[] {
  const { ctx, view, tablePos, grid } = target;
  return [
    ...alignmentItems(target, col),
    {
      label: 'Insert 1 column left',
      icon: icons.arrowLeft,
      group: true,
      run: () => insertColumn(ctx, view, tablePos, col),
    },
    {
      label: 'Insert 1 column right',
      icon: icons.arrowRight,
      run: () => insertColumn(ctx, view, tablePos, col + 1),
    },
    {
      label: 'Duplicate column',
      icon: icons.copy,
      run: () => duplicateColumn(view, tablePos, col),
    },
    {
      label: 'Move column left',
      icon: icons.arrowLeft,
      group: true,
      disabled: col === 0,
      run: () => moveColumn(ctx, view, tablePos, col, col - 1),
    },
    {
      label: 'Move column right',
      icon: icons.arrowRight,
      disabled: col >= grid.cols - 1,
      run: () => moveColumn(ctx, view, tablePos, col, col + 1),
    },
    {
      label: 'Delete column',
      icon: icons.trash,
      group: true,
      danger: true,
      disabled: !canDeleteColumn(grid),
      run: () => deleteColumn(ctx, view, tablePos, col),
    },
  ];
}

export function rowMenuItems(target: Target, row: number): MenuItem[] {
  const { ctx, view, tablePos, grid } = target;
  return [
    {
      label: 'Insert 1 row above',
      icon: icons.arrowUp,
      // Row 0 is the header row: nothing goes above it.
      disabled: row === 0,
      run: () => insertRow(ctx, view, tablePos, row),
    },
    {
      label: 'Insert 1 row below',
      icon: icons.arrowDown,
      run: () => insertRow(ctx, view, tablePos, row + 1),
    },
    {
      label: 'Duplicate row',
      icon: icons.copy,
      disabled: row === 0,
      run: () => duplicateRow(view, tablePos, row),
    },
    {
      label: 'Move row up',
      icon: icons.arrowUp,
      group: true,
      disabled: row <= 1,
      run: () => moveRow(ctx, view, tablePos, row, row - 1),
    },
    {
      label: 'Move row down',
      icon: icons.arrowDown,
      disabled: row === 0 || row >= grid.rows - 1,
      run: () => moveRow(ctx, view, tablePos, row, row + 1),
    },
    {
      label: 'Delete row',
      icon: icons.trash,
      group: true,
      danger: true,
      disabled: !canDeleteRow(grid, row),
      run: () => deleteRow(ctx, view, tablePos, row),
    },
  ];
}

export function tableMenuItems({ ctx, view, tablePos }: Target): MenuItem[] {
  return [
    {
      label: 'Select all cells',
      icon: icons.table,
      run: () => selectWholeTable(ctx, view, tablePos),
    },
    {
      label: 'Delete table',
      icon: icons.trash,
      group: true,
      danger: true,
      run: () => deleteTable(ctx, view, tablePos),
    },
  ];
}

/**
 * The right-click menu: the Docs shape — insert in all four directions, then
 * the three deletes — flattened into one list so no cell is more than one
 * gesture from any structural edit. This is what makes the pills' header-row
 * activation affordable: the pointer never *has* to travel to row 1.
 */
export function contextMenuItems(target: Target, row: number, col: number): MenuItem[] {
  const { ctx, view, tablePos, grid } = target;
  return [
    {
      label: 'Insert 1 row above',
      icon: icons.arrowUp,
      disabled: row === 0,
      run: () => insertRow(ctx, view, tablePos, row),
    },
    {
      label: 'Insert 1 row below',
      icon: icons.arrowDown,
      run: () => insertRow(ctx, view, tablePos, row + 1),
    },
    {
      label: 'Insert 1 column left',
      icon: icons.arrowLeft,
      run: () => insertColumn(ctx, view, tablePos, col),
    },
    {
      label: 'Insert 1 column right',
      icon: icons.arrowRight,
      run: () => insertColumn(ctx, view, tablePos, col + 1),
    },
    ...alignmentItems(target, col).map((item, index) => ({
      ...item,
      group: index === 0,
    })),
    {
      label: 'Delete row',
      icon: icons.trash,
      group: true,
      danger: true,
      disabled: !canDeleteRow(grid, row),
      run: () => deleteRow(ctx, view, tablePos, row),
    },
    {
      label: 'Delete column',
      icon: icons.trash,
      danger: true,
      disabled: !canDeleteColumn(grid),
      run: () => deleteColumn(ctx, view, tablePos, col),
    },
    {
      label: 'Delete table',
      icon: icons.trash,
      danger: true,
      run: () => deleteTable(ctx, view, tablePos),
    },
  ];
}

/** Resolve the menu target for a table at `tablePos`, or `null` if it is gone. */
export function menuTarget(ctx: Ctx, view: EditorView, tablePos: number): Target | null {
  const grid = resolveGrid(view, tablePos);
  return grid ? { ctx, view, tablePos, grid } : null;
}
