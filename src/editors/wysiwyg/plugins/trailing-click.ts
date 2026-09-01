import { paragraphSchema } from '@milkdown/kit/preset/commonmark';
import { Plugin, TextSelection } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';

import { needsTrailingParagraph } from './trailing-paragraph';

/**
 * Clicking the empty space below the document should extend it, not jump to
 * the top of it.
 *
 * When the last block keeps its content out of ProseMirror's DOM map,
 * `posAtCoords` can't resolve a position in that gutter and silently falls
 * back to position 0 — so the next keystroke lands at the very start of the
 * document. Append a paragraph and put the caret there instead, which is what
 * the click plainly meant.
 *
 * `trailingParagraph` now keeps such a document ending in a paragraph, so this
 * rarely has anything left to catch. It stays as the guard for the moment
 * before that plugin's first pass, and because the failure it prevents —
 * silently typing into the top of the document — is a bad one.
 */

export const trailingClickPlugin = $prose(
  (ctx) =>
    new Plugin({
      props: {
        handleDOMEvents: {
          mousedown: (view, event) => {
            if (!view.editable || event.button !== 0) return false;
            // Only the editor's own padding — never a click on real content.
            if (event.target !== view.dom) return false;

            const last = view.state.doc.lastChild;
            if (!last || !needsTrailingParagraph(last)) return false;

            const dom = view.nodeDOM(view.state.doc.content.size - last.nodeSize);
            if (!(dom instanceof HTMLElement)) return false;
            if (event.clientY <= dom.getBoundingClientRect().bottom) return false;

            const end = view.state.doc.content.size;
            const tr = view.state.tr.insert(end, paragraphSchema.type(ctx).create());
            tr.setSelection(TextSelection.near(tr.doc.resolve(end), 1));
            view.dispatch(tr.scrollIntoView());
            view.focus();
            event.preventDefault();
            return true;
          },
        },
      },
    }),
);
