import { linkTooltipState } from '@milkdown/kit/component/link-tooltip';
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
  readonly #ctx: Ctx;
  readonly #view: EditorView;
  readonly #content: HTMLElement;
  readonly #provider: TooltipProvider;
  readonly #markButtons: MarkButton[] = [];
  readonly #turnInto: HTMLSelectElement;
  #unwatchLinkMode: () => void = () => {};
  /**
   * The link editor takes focus without producing a transaction, and a DOM
   * focus change alone never reaches a ProseMirror plugin — so re-evaluate
   * when the editor gets focus back, or the menu stays hidden after Escape
   * until the caret happens to move.
   */
  readonly #onEditorFocus = () => this.#provider.update(this.#view);

  constructor(ctx: Ctx, view: EditorView) {
    this.#ctx = ctx;
    this.#view = view;
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

    // The link editor keeps the selection it was opened on, so every
    // selection-shaped test still says "show a bubble here". It announces
    // itself through this slice instead — the same one the kit's own link
    // *preview* tooltip watches to get out of the way. `#shouldShow` reads it
    // too; this covers the closing edge, which arrives without a transaction.
    this.#unwatchLinkMode = ctx.use(linkTooltipState.key).on(({ mode }) => {
      if (mode === 'edit') this.#provider.hide();
    });
    view.dom.addEventListener('focus', this.#onEditorFocus);

    this.update(view);
  }

  #shouldShow(view: EditorView): boolean {
    const { state } = view;
    const { selection } = state;
    const { empty, from, to } = selection;
    if (!(selection instanceof TextSelection)) return false;
    // One surface per selection: while the link editor is open it owns this
    // range, and both anchor to the same rect — so a bubble here lands on top
    // of the URL field and swallows the clicks meant for it.
    if (this.#ctx.get(linkTooltipState.key).mode === 'edit') return false;
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
    this.#unwatchLinkMode();
    this.#view.dom.removeEventListener('focus', this.#onEditorFocus);
    this.#provider.destroy();
    this.#content.remove();
  }
}

export function configureBubbleMenu(ctx: Ctx) {
  ctx.set(bubbleTooltip.key, {
    view: (view: EditorView) => new BubbleMenuView(ctx, view),
  });
}
