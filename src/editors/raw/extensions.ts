import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { bracketMatching, indentOnInput, indentUnit } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import {
  highlightSelectionMatches,
  search,
  searchKeymap,
  selectNextOccurrence,
} from '@codemirror/search';
import { Annotation, Compartment, EditorState, type Extension } from '@codemirror/state';
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view';

import { formatCommands } from '@/editors/raw/format-commands';
import { imagePasteExtension } from '@/editors/raw/image-paste';
import { insertCode } from '@/editors/raw/toolbar-commands';
import { computeRawSelectionState } from '@/editors/raw/toolbar-state';
import { rawEditorTheme, rawSyntaxHighlighting } from '@/editors/raw/theme';
import type { WysiwygSelectionState } from '@/editors/wysiwyg/selection-state';

/** Transactions carrying this annotation come from the store — never re-emitted (loop guard). */
export const syncAnnotation = Annotation.define<boolean>();

export const lineNumbersCompartment = new Compartment();

/** Formatting shortcut map (FR-3.5, §8.3). */
const formatKeymap = keymap.of([
  { key: 'Mod-b', run: formatCommands.bold },
  { key: 'Mod-i', run: formatCommands.italic },
  { key: 'Mod-Shift-x', run: formatCommands.strikethrough },
  { key: 'Mod-e', run: insertCode },
  { key: 'Mod-k', run: formatCommands.link },
  { key: 'Mod-Alt-1', run: formatCommands.h1 },
  { key: 'Mod-Alt-2', run: formatCommands.h2 },
  { key: 'Mod-Alt-3', run: formatCommands.h3 },
  { key: 'Mod-Shift-8', run: formatCommands.bulletList },
  { key: 'Mod-Shift-7', run: formatCommands.orderedList },
  { key: 'Mod-Shift-9', run: formatCommands.taskList },
  { key: 'Mod-Shift-b', run: formatCommands.quote },
  { key: 'Mod-d', run: selectNextOccurrence, preventDefault: true },
]);

export interface RawExtensionOptions {
  lineNumbers: boolean;
  /** Called with the full text after user-originated doc changes. */
  onUserChange: (text: string) => void;
  /** Called on selection movement with 1-based line / column. */
  onCursor?: (line: number, col: number) => void;
  /** Called on selection change with the selected plain text ('' when collapsed). */
  onSelectionText?: (text: string) => void;
  /** Toolbar reflection (dual mode): caret-context state. Unset ⇒ never computed. */
  onSelectionState?: (state: WysiwygSelectionState) => void;
}

export function buildRawExtensions(options: RawExtensionOptions): Extension[] {
  return [
    lineNumbersCompartment.of(options.lineNumbers ? [lineNumbers()] : []),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    rectangularSelection(),
    crosshairCursor(),
    indentOnInput(),
    indentUnit.of('  '),
    bracketMatching(),
    closeBrackets(),
    // Emphasis auto-pairing (FR-3.2): add * and ~ to the closable set.
    markdownLanguage.data.of({
      closeBrackets: { brackets: ['(', '[', '{', "'", '"', '`', '*', '~'] },
    }),
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    search({ top: true }),
    highlightSelectionMatches(),
    EditorView.lineWrapping,
    rawEditorTheme,
    rawSyntaxHighlighting,
    imagePasteExtension,
    formatKeymap,
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      indentWithTab,
    ]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const isSync = update.transactions.some((tr) => tr.annotation(syncAnnotation));
        if (!isSync) options.onUserChange(update.state.doc.toString());
      }
      if (update.selectionSet || update.docChanged) {
        const { main } = update.state.selection;
        if (options.onCursor) {
          const line = update.state.doc.lineAt(main.head);
          options.onCursor(line.number, main.head - line.from + 1);
        }
        options.onSelectionText?.(update.state.sliceDoc(main.from, main.to));
        options.onSelectionState?.(computeRawSelectionState(update.state));
      }
    }),
    EditorView.contentAttributes.of({ 'aria-label': 'Markdown source editor' }),
  ];
}
