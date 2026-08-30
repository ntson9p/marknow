import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';

/**
 * Shared by `.cm-content` and `.cm-gutters`: CM's base theme puts 1.4 on the
 * scroller, which the gutter inherits, so a line number's text box would sit a
 * pixel above the text of the line it labels. One constant keeps them equal.
 */
const EDITOR_LINE_HEIGHT = '1.6';

/**
 * CM6 theme driven by the app's CSS variables so light/dark switching is
 * instant (FR-13.1) without editor reconfiguration.
 */
export const rawEditorTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: 'var(--editor-font-size, 14px)',
    backgroundColor: 'transparent',
    color: 'var(--foreground)',
  },
  '.cm-content': {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
    caretColor: 'var(--foreground)',
    padding: '16px 0',
    lineHeight: EDITOR_LINE_HEIGHT,
  },
  '.cm-line': { padding: '0 16px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--foreground)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground':
    {
      backgroundColor: 'color-mix(in oklch, var(--primary) 22%, transparent)',
    },
  '.cm-activeLine': { backgroundColor: 'color-mix(in oklch, var(--muted) 55%, transparent)' },
  '.cm-activeLineGutter': {
    backgroundColor: 'color-mix(in oklch, var(--muted) 55%, transparent)',
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--muted-foreground)',
    border: 'none',
    paddingLeft: '4px',
    lineHeight: EDITOR_LINE_HEIGHT,
  },
  '.cm-selectionMatch': {
    backgroundColor: 'color-mix(in oklch, var(--primary) 14%, transparent)',
  },
  '.cm-searchMatch': {
    backgroundColor: 'color-mix(in oklch, var(--primary) 25%, transparent)',
    outline: '1px solid color-mix(in oklch, var(--primary) 45%, transparent)',
  },
  '.cm-searchMatch-selected': {
    backgroundColor: 'color-mix(in oklch, var(--primary) 45%, transparent)',
  },
  '.cm-panels': {
    backgroundColor: 'var(--popover)',
    color: 'var(--popover-foreground)',
    borderBottom: '1px solid var(--border)',
  },
  '.cm-panels input, .cm-panels button, .cm-panels label': { fontSize: '12px' },
  '.cm-panels input': {
    backgroundColor: 'var(--background)',
    color: 'var(--foreground)',
    border: '1px solid var(--input)',
    borderRadius: '4px',
  },
  '.cm-panels button': {
    backgroundImage: 'none',
    backgroundColor: 'var(--secondary)',
    color: 'var(--secondary-foreground)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--popover)',
    color: 'var(--popover-foreground)',
    border: '1px solid var(--border)',
    borderRadius: '6px',
  },
});

/** Markdown syntax colors (FR-3.1), CSS-variable based for theming. */
export const markdownHighlightStyle = HighlightStyle.define([
  { tag: tags.heading, color: 'var(--cm-heading)', fontWeight: '650' },
  { tag: tags.strong, fontWeight: '650' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through', color: 'var(--muted-foreground)' },
  { tag: tags.link, color: 'var(--cm-link)' },
  { tag: tags.url, color: 'var(--cm-url)', textDecoration: 'underline' },
  { tag: tags.monospace, color: 'var(--cm-code)' },
  { tag: tags.quote, color: 'var(--cm-quote)', fontStyle: 'italic' },
  { tag: tags.contentSeparator, color: 'var(--muted-foreground)', fontWeight: '650' },
  { tag: tags.list, color: 'var(--cm-marker)' },
  { tag: tags.meta, color: 'var(--muted-foreground)' },
  { tag: tags.processingInstruction, color: 'var(--cm-marker)' },
  { tag: tags.labelName, color: 'var(--cm-url)' },
  { tag: tags.escape, color: 'var(--cm-marker)' },
  // Nested code-fence languages:
  { tag: tags.keyword, color: 'var(--cm-kw)' },
  { tag: tags.string, color: 'var(--cm-str)' },
  { tag: tags.comment, color: 'var(--cm-comment)', fontStyle: 'italic' },
  { tag: tags.number, color: 'var(--cm-num)' },
  { tag: tags.bool, color: 'var(--cm-num)' },
  { tag: tags.function(tags.variableName), color: 'var(--cm-fn)' },
  { tag: tags.typeName, color: 'var(--cm-type)' },
  { tag: tags.className, color: 'var(--cm-type)' },
  { tag: tags.propertyName, color: 'var(--cm-prop)' },
  { tag: tags.operator, color: 'var(--cm-marker)' },
  { tag: tags.atom, color: 'var(--cm-num)' },
  { tag: tags.tagName, color: 'var(--cm-kw)' },
  { tag: tags.attributeName, color: 'var(--cm-prop)' },
]);

export const rawSyntaxHighlighting = syntaxHighlighting(markdownHighlightStyle);
