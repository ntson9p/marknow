import { Plugin } from '@milkdown/kit/prose/state';
import type { EditorState } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

/**
 * An armed inline-code mark has nothing to show for itself: a mark cannot span
 * an empty range, so pressing the code button with a bare caret would look like
 * the no-op it used to be. This draws an empty code chip at the caret for
 * exactly as long as the mark stays armed.
 *
 * `storedMarks` is the whole state machine. ProseMirror clears it on the next
 * document step or selection change, so the chip lives precisely until the user
 * types (real inline code takes its place) or moves away (nothing was ever
 * written to the document).
 *
 * The chip is a plain element parked in `.wysiwyg-root`, deliberately *not* a
 * widget decoration. A widget is DOM inside the textblock, and `addTextblockHacks`
 * appends a `<br class="ProseMirror-trailingBreak">` to any textblock whose last
 * child is not a text node — so arming at the end of a paragraph grew a second
 * line box and dropped the caret onto it. Nothing drawn here is inside the
 * contenteditable, so there is nothing for that rule to fire on.
 *
 * `.wysiwyg-root` is `position: relative` and is not itself the scroll container
 * (that is an ancestor), so chip and text share one coordinate space and scroll
 * together — no scroll listener, no drift.
 */

/** Fractions of the caret's own font size, matching `.md-doc code`'s padding. */
const CHIP_INSET = 0.31;
const CHIP_WIDTH = 0.72;

function isArmed(state: EditorState): boolean {
  const type = state.schema.marks.inlineCode;
  const { selection, storedMarks } = state;
  // Only an *explicitly* armed mark draws a chip — `storedMarks` is null when
  // the caret merely sits inside existing inline code.
  return !!type && selection.empty && !!storedMarks && !!type.isInSet(storedMarks);
}

/** Font size at `pos`, so the chip scales with headings and other larger text. */
function fontSizeAt(view: EditorView, pos: number): number {
  const { node } = view.domAtPos(pos);
  const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement);
  const size = el ? Number.parseFloat(getComputedStyle(el).fontSize) : Number.NaN;
  return Number.isFinite(size) ? size : 16;
}

class InlineCodeCaretView {
  readonly #view: EditorView;
  readonly #root: HTMLElement | null;
  #chip: HTMLElement | null = null;
  /** Focus and reflow move the caret without producing a transaction. */
  readonly #redraw = () => this.#draw();

  constructor(view: EditorView) {
    this.#view = view;
    this.#root = view.dom.closest<HTMLElement>('.wysiwyg-root');
    view.dom.addEventListener('focus', this.#redraw);
    view.dom.addEventListener('blur', this.#redraw);
    window.addEventListener('resize', this.#redraw);
    this.#draw();
  }

  update() {
    this.#draw();
  }

  destroy() {
    this.#view.dom.removeEventListener('focus', this.#redraw);
    this.#view.dom.removeEventListener('blur', this.#redraw);
    window.removeEventListener('resize', this.#redraw);
    this.#chip?.remove();
    this.#chip = null;
  }

  #draw() {
    const view = this.#view;
    const root = this.#root;
    if (!root || !isArmed(view.state) || !view.hasFocus()) {
      this.#hide();
      return;
    }

    const head = view.state.selection.head;
    let coords;
    try {
      coords = view.coordsAtPos(head);
    } catch {
      // The position is not currently rendered (a collapsed or replaced
      // subtree); there is nowhere honest to put the chip.
      this.#hide();
      return;
    }

    const box = root.getBoundingClientRect();
    const size = fontSizeAt(view, head);
    const chip = this.#ensureChip(root);
    // Viewport coordinates → the root's padding box, which is the chip's
    // containing block. The scroll terms are zero today and cost nothing.
    const left = coords.left - box.left - root.clientLeft + root.scrollLeft;
    const top = coords.top - box.top - root.clientTop + root.scrollTop;
    chip.style.left = `${left - CHIP_INSET * size}px`;
    chip.style.top = `${top}px`;
    chip.style.width = `${CHIP_WIDTH * size}px`;
    chip.style.height = `${coords.bottom - coords.top}px`;
    chip.hidden = false;
  }

  #ensureChip(root: HTMLElement): HTMLElement {
    if (!this.#chip) {
      const chip = document.createElement('span');
      chip.className = 'mk-inline-code-caret';
      chip.setAttribute('aria-hidden', 'true');
      root.appendChild(chip);
      this.#chip = chip;
    }
    return this.#chip;
  }

  #hide() {
    if (this.#chip) this.#chip.hidden = true;
  }
}

export const inlineCodeCaretPlugin = $prose(
  () => new Plugin({ view: (view) => new InlineCodeCaretView(view) }),
);
