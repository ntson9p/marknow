import { commandsCtx, editorViewCtx } from '@milkdown/kit/core';
import type { CmdKey } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import {
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInHeadingCommand,
} from '@milkdown/kit/preset/commonmark';
import { toggleStrikethroughCommand } from '@milkdown/kit/preset/gfm';
import { tooltipFactory, TooltipProvider } from '@milkdown/kit/plugin/tooltip';
import { TextSelection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';

import { computeSelectionState, type BlockType } from '../selection-state';
import { triggerLinkEdit } from '../shortcuts';
import { icons } from './icons';

/**
 * Bubble menu (FR-5.4): a selection-anchored, collision-aware formatting
 * surface — bold, italic, strikethrough, inline code, link, and a "turn into"
 * block-type control. Built on the tooltip plugin (flip/shift middleware ship
 * in the provider), so it is the primary formatting surface on touch (FR-5.4).
 */
export const bubbleTooltip = tooltipFactory('marknow-bubble');

interface MarkButton {
  el: HTMLButtonElement;
  isActive: (s: ReturnType<typeof computeSelectionState>) => boolean;
}

class BubbleMenuView {
  readonly #content: HTMLElement;
  readonly #provider: TooltipProvider;
  readonly #markButtons: MarkButton[] = [];
  readonly #turnInto: HTMLSelectElement;

  constructor(ctx: Ctx, view: EditorView) {
    const content = document.createElement('div');
    content.className = 'milkdown-bubble-menu';
    content.setAttribute('role', 'toolbar');
    content.setAttribute('aria-label', 'Selection formatting');
    // Keep the editor selection alive while interacting with the menu — but
    // not over a native control, whose default mousedown action *is* the
    // interaction: cancelling it stops a <select> from opening at all.
    content.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).closest('select, input, textarea')) return;
      e.preventDefault();
    });
    this.#content = content;

    const run = <T>(key: CmdKey<T>, payload?: T) => {
      ctx.get(commandsCtx).call(key, payload);
      ctx.get(editorViewCtx).focus();
    };

    const addMark = (
      label: string,
      icon: string,
      onClick: () => void,
      isActive: (s: ReturnType<typeof computeSelectionState>) => boolean,
    ) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'bubble-btn';
      el.setAttribute('aria-label', label);
      el.setAttribute('aria-pressed', 'false');
      el.title = label;
      el.innerHTML = icon;
      el.addEventListener('click', onClick);
      content.appendChild(el);
      this.#markButtons.push({ el, isActive });
    };

    addMark(
      'Bold (Ctrl+B)',
      icons.bold,
      () => run(toggleStrongCommand.key),
      (s) => s.strong,
    );
    addMark(
      'Italic (Ctrl+I)',
      icons.italic,
      () => run(toggleEmphasisCommand.key),
      (s) => s.emphasis,
    );
    addMark(
      'Strikethrough (Ctrl+Shift+X)',
      icons.strikethrough,
      () => run(toggleStrikethroughCommand.key),
      (s) => s.strikethrough,
    );
    addMark(
      'Inline code (Ctrl+E)',
      icons.code,
      () => run(toggleInlineCodeCommand.key),
      (s) => s.inlineCode,
    );
    addMark(
      'Link (Ctrl+K)',
      icons.link,
      () => {
        const v = ctx.get(editorViewCtx);
        triggerLinkEdit(ctx, v.state);
      },
      (s) => s.link,
    );

    const divider = document.createElement('span');
    divider.className = 'bubble-divider';
    divider.setAttribute('aria-hidden', 'true');
    content.appendChild(divider);

    // Turn-into: convert the enclosing block. A native select stays keyboard-
    // and touch-accessible and keeps the menu open (focus stays in content).
    const turnInto = document.createElement('select');
    turnInto.className = 'bubble-turn-into';
    turnInto.setAttribute('aria-label', 'Turn into');
    const OPTIONS: [BlockType, string][] = [
      ['paragraph', 'Text'],
      ['h1', 'Heading 1'],
      ['h2', 'Heading 2'],
      ['h3', 'Heading 3'],
      ['quote', 'Quote'],
    ];
    for (const [value, text] of OPTIONS) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = text;
      turnInto.appendChild(opt);
    }
    turnInto.addEventListener('change', () => {
      const value = turnInto.value as BlockType;
      if (value.startsWith('h')) run(wrapInHeadingCommand.key, Number(value.slice(1)));
      else if (value === 'quote') run(wrapInBlockquoteCommand.key);
      else run(turnIntoTextCommand.key);
    });
    content.appendChild(turnInto);
    this.#turnInto = turnInto;

    this.#provider = new TooltipProvider({
      content,
      debounce: 20,
      offset: 8,
      shouldShow: (v) => this.#shouldShow(v),
      // Fixed strategy renders above the page surface without clipping.
      floatingUIOptions: { strategy: 'fixed' },
    });

    this.update(view);
  }

  #shouldShow(view: EditorView): boolean {
    const { state } = view;
    const { selection } = state;
    const { empty, from, to } = selection;
    if (!(selection instanceof TextSelection)) return false;
    const isTooltipFocused = this.#content.contains(document.activeElement);
    if ((!view.hasFocus() && !isTooltipFocused) || empty || !view.editable) return false;
    if (state.doc.textBetween(from, to).length === 0) return false;
    // Marks don't apply inside code blocks — no bubble there.
    if (selection.$from.parent.type.spec.code) return false;
    return true;
  }

  update(view: EditorView) {
    this.#provider.update(view);
    // Reflect selection state every update (not gated on the throttled
    // `data-show`) so the buttons are correct the instant the menu appears.
    const s = computeSelectionState(view.state);
    for (const { el, isActive } of this.#markButtons) {
      const active = isActive(s);
      el.classList.toggle('active', active);
      el.setAttribute('aria-pressed', String(active));
    }
    const value: BlockType = ['paragraph', 'h1', 'h2', 'h3', 'quote'].includes(s.blockType)
      ? s.blockType
      : 'paragraph';
    this.#turnInto.value = value;
  }

  destroy() {
    this.#provider.destroy();
    this.#content.remove();
  }
}

export function configureBubbleMenu(ctx: Ctx) {
  ctx.set(bubbleTooltip.key, {
    view: (view: EditorView) => new BubbleMenuView(ctx, view),
  });
}
