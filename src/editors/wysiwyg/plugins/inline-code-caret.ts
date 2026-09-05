import { Plugin } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

/**
 * An armed inline-code mark has nothing to show for itself: a mark cannot span
 * an empty range, so pressing the code button with a bare caret would look
 * like the no-op it used to be. This draws an empty code chip around the caret
 * for exactly as long as the mark stays armed.
 *
 * `storedMarks` is the whole state machine. ProseMirror clears it on the next
 * document step or selection change, so the chip lives precisely until the
 * user types (real inline code takes its place) or moves away (nothing was
 * ever written to the document). Decoration-only, so it never serializes.
 */
export const inlineCodeCaretPlugin = $prose(
  () =>
    new Plugin({
      props: {
        decorations: (state) => {
          const type = state.schema.marks.inlineCode;
          const { selection, storedMarks } = state;
          // Only an *explicitly* armed mark draws a chip — `storedMarks` is
          // null when the caret merely sits inside existing inline code.
          if (!type || !storedMarks || !selection.empty) return null;
          if (!type.isInSet(storedMarks)) return null;

          return DecorationSet.create(state.doc, [
            Decoration.widget(
              selection.head,
              () => {
                const chip = document.createElement('span');
                chip.className = 'mk-inline-code-caret';
                chip.setAttribute('aria-hidden', 'true');
                return chip;
              },
              // The chip is painted by CSS around the caret from a zero-width
              // box, so it neither shifts the text nor joins the selection.
              { side: -1, marks: [], ignoreSelection: true },
            ),
          ]);
        },
      },
    }),
);
