import { languages } from '@codemirror/language-data';
import { EditorView as CmEditorView } from '@codemirror/view';
import { codeBlockComponent, codeBlockConfig } from '@milkdown/kit/component/code-block';
import { configureLinkTooltip, linkTooltipPlugin } from '@milkdown/kit/component/link-tooltip';
import { listItemBlockComponent } from '@milkdown/kit/component/list-item-block';
import {
  defaultValueCtx,
  Editor,
  editorViewCtx,
  editorViewOptionsCtx,
  remarkStringifyOptionsCtx,
  rootCtx,
} from '@milkdown/kit/core';
import { block } from '@milkdown/kit/plugin/block';
import { clipboard } from '@milkdown/kit/plugin/clipboard';
import { cursor } from '@milkdown/kit/plugin/cursor';
import { history } from '@milkdown/kit/plugin/history';
import { indent } from '@milkdown/kit/plugin/indent';
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
import * as commonmarkExports from '@milkdown/kit/preset/commonmark';
import { commonmark, remarkInlineLinkPlugin } from '@milkdown/kit/preset/commonmark';
import { gfm, remarkGFMPlugin } from '@milkdown/kit/preset/gfm';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { Plugin } from '@milkdown/kit/prose/state';
import type { EditorState } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';

import {
  DEFAULT_STYLE_PREFS,
  toGfmOptions,
  toStringifyOptions,
  type MarkdownStylePrefs,
} from '@/core/markdown/style';
import { rawSyntaxHighlighting } from '@/editors/raw/theme';

import { wysiwygCommands } from './commands';
import { wysiwygInputRules } from './input-rules';
import { calloutMarkerHandler, calloutNodes } from './nodes/callout';
import { definitionNodes } from './nodes/definition';
import { diagramNodes } from './nodes/diagram';
import { htmlBlockNodes } from './nodes/html-block';
import { mathNodes } from './nodes/math';
import { tableBreakNodes } from './nodes/table-break';
import { listSpreadFixes } from './plugins/list-spread-fix';
import { remarkReferencesPlugin } from './plugins/references';
import { wysiwygRemarkPlugins } from './plugins/remark-plugins';
import { wysiwygKeymap } from './shortcuts';
import { blockDropCursor, configureBlockHandle } from './plugins/block-handle';
import { bubbleTooltip, configureBubbleMenu } from './plugins/bubble-menu';
import { codeBlockKeymap } from './plugins/code-block-keymap';
import { findPlugin } from './plugins/find';
import { imagePastePlugin } from './plugins/image-paste';
import { listA11yPlugin } from './plugins/list-a11y';
import { configureListItemBlock } from './plugins/list-item-block';
import { placeholderPlugin } from './plugins/placeholder';
import { configureSlashMenu, slashMenu } from './plugins/slash-menu';
import { tableContextMenu } from './plugins/table-context-menu';
import { tableEnterKeymap } from './plugins/table-keymap';
import { trailingClickPlugin } from './plugins/trailing-click';
import { trailingBackspaceKeymap, trailingParagraph } from './plugins/trailing-paragraph';
import { calloutView } from './views/callout-view';
import { definitionView } from './views/definition-view';
import { diagramView } from './views/diagram-view';
import { htmlViews } from './views/html-views';
import { imageView } from './views/image-view';
import { mathViews } from './views/math-views';
import { tableView } from './views/table-view';

/**
 * Exported at runtime but missing from the package typings.
 * preserve-empty-line rewrites empty paragraphs to `<br />` html on
 * serialize; inside list items that grows a new `<br />` per round-trip
 * (non-idempotent), and it injects HTML the user never wrote. Empty
 * paragraphs are transient editing state — dropping them on serialize is the
 * correct normalization.
 */
const remarkPreserveEmptyLinePlugin = (
  commonmarkExports as unknown as Record<
    'remarkPreserveEmptyLinePlugin',
    typeof remarkInlineLinkPlugin
  >
).remarkPreserveEmptyLinePlugin;

/**
 * preset-commonmark minus `remark-inline-links` (silently drops link
 * definitions — content loss; our references plugin resolves references and
 * preserves definitions as chips) and minus preserve-empty-line (see above).
 */
const EXCLUDED_PRESET_PLUGINS = new Set([
  remarkInlineLinkPlugin.plugin,
  remarkInlineLinkPlugin.options,
  remarkPreserveEmptyLinePlugin.plugin,
  remarkPreserveEmptyLinePlugin.options,
]);

const commonmarkPreset = commonmark.filter((plugin) => !EXCLUDED_PRESET_PLUGINS.has(plugin));

export interface CreateWysiwygEditorOptions {
  root: HTMLElement;
  defaultValue?: string;
  stylePrefs?: MarkdownStylePrefs;
  /** Reactive editable flag; defaults to always-editable. */
  editable?: () => boolean;
  /**
   * Fires on every user-driven markdown change (undebounced — adapters
   * debounce). Output is already normalized (empty doc → empty string).
   */
  onMarkdownUpdated?: (markdown: string) => void;
  /** Fires on every editor state change — drives toolbar selection reflection (FR-5.2). */
  onStateChange?: (state: EditorState) => void;
}

/**
 * Milkdown's preserve-empty-line plugin serializes a truly empty document
 * (one empty paragraph) as `<br />`. An empty document must serialize to an
 * empty string — apply this to every serializer output.
 */
export function normalizeSerialized(doc: ProseNode, markdown: string): string {
  const first = doc.firstChild;
  if (doc.childCount === 1 && first?.type.name === 'paragraph' && first.content.size === 0) {
    return '';
  }
  // The paragraph `trailingParagraph` keeps below a table or a code block is
  // there so the caret has somewhere to go — chrome, not content. It costs one
  // extra newline, and without dropping it every such document would count as
  // edited the moment it was opened.
  const last = doc.lastChild;
  if (doc.childCount > 1 && last?.type.name === 'paragraph' && last.content.size === 0) {
    return markdown.replace(/\n+$/, '\n');
  }
  return markdown;
}

/**
 * The single WYSIWYG serializer configuration (plan §3.1): shared stringify
 * style prefs + the calloutMarker verbatim handler.
 */
export function wysiwygStringifyOptions(prefs: MarkdownStylePrefs) {
  return {
    ...toStringifyOptions(prefs),
    // Handlers for custom mdast nodes; the upstream type only enumerates
    // built-in node types, hence the cast.
    handlers: { calloutMarker: calloutMarkerHandler } as unknown as NonNullable<
      import('remark-stringify').Options['handlers']
    >,
  };
}

/**
 * Builds the Milkdown editor used by both the app (WysiwygEditor component)
 * and the round-trip corpus — the corpus therefore tests the exact grammar
 * configuration that ships (plan §1, §3).
 *
 * Plugin order matters: presets register before the custom nodes so that
 * ProseMirror's default block filler resolves to `paragraph` (a `callout`
 * registered first would recurse — its content is `block+`). Parse-matcher
 * conflicts are avoided by re-tagging mdast types in the remark transforms
 * instead of relying on registration order.
 */
export function createWysiwygEditor(options: CreateWysiwygEditorOptions): Promise<Editor> {
  const prefs = options.stylePrefs ?? DEFAULT_STYLE_PREFS;

  const statePlugin = $prose(() => {
    return new Plugin({
      view: (view) => {
        options.onStateChange?.(view.state);
        return {
          update: (v) => options.onStateChange?.(v.state),
        };
      },
    });
  });

  return (
    Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, options.root);
        ctx.set(defaultValueCtx, options.defaultValue ?? '');
        ctx.set(remarkStringifyOptionsCtx, wysiwygStringifyOptions(prefs));
        // Table style (FR-13.2): compact by default — aligning pads every row
        // of every table on any edit; the pref opts back into alignment.
        ctx.set(remarkGFMPlugin.options.key, toGfmOptions(prefs));
        // Label the contenteditable surface for screen readers (§a11y; axe
        // aria-input-field-name). Merge so Milkdown's own attributes survive.
        ctx.update(editorViewOptionsCtx, (prev) => {
          const prevAttrs =
            prev.attributes && typeof prev.attributes === 'object' ? prev.attributes : {};
          return {
            ...prev,
            ...(options.editable ? { editable: options.editable } : {}),
            attributes: { ...prevAttrs, 'aria-label': 'Rich text editor' },
          };
        });
        if (options.onMarkdownUpdated) {
          const on = options.onMarkdownUpdated;
          ctx.get(listenerCtx).markdownUpdated((innerCtx, markdown, prevMarkdown) => {
            if (markdown === prevMarkdown) return;
            const view = innerCtx.get(editorViewCtx);
            on(normalizeSerialized(view.state.doc, markdown));
          });
        }
        // Code blocks: CodeMirror-backed editing with a language picker
        // (FR-5.1) — reuses the CM languages already shipped for raw mode.
        ctx.update(codeBlockConfig.key, (prev) => ({
          ...prev,
          languages,
          extensions: [
            // Theme-aware, AA-contrast highlighting shared with raw mode — the
            // light-only defaultHighlightStyle is unreadable on the dark code
            // surface (§a11y, FR-13.1).
            rawSyntaxHighlighting,
            // Label the code-block editor for screen readers (§a11y).
            CmEditorView.contentAttributes.of({ 'aria-label': 'Code block editor' }),
            // Tab to indent, Escape/blank-line-Enter to get back out.
            codeBlockKeymap(ctx),
          ],
        }));
        configureLinkTooltip(ctx);
        // List markers (FR-4.4) — the component draws its own; match the
        // preview's `disc`.
        configureListItemBlock(ctx);
        // WYSIWYG UX polish (M4): bubble menu, slash commands, block handles.
        configureBubbleMenu(ctx);
        configureSlashMenu(ctx);
        configureBlockHandle(ctx);
      })
      // Our keymap registers before the presets so §9.3 bindings win.
      .use(wysiwygKeymap)
      // Likewise for Enter in a table, which the gfm preset routes to
      // ExitTable — see the plugin for why that needs intercepting.
      .use(tableEnterKeymap)
      // Backspace in the kept trailing paragraph — must beat joinBackward.
      .use(trailingBackspaceKeymap)
      .use(wysiwygRemarkPlugins)
      .use(remarkReferencesPlugin)
      .use(commonmarkPreset)
      .use(gfm)
      .use(listSpreadFixes)
      .use(calloutNodes)
      .use(diagramNodes)
      .use(htmlBlockNodes)
      .use(mathNodes)
      // A cell's only possible line break (FR-5.7) — see nodes/table-break.ts.
      .use(tableBreakNodes)
      .use(definitionNodes)
      .use(wysiwygCommands.flat())
      .use(wysiwygInputRules)
      .use(calloutView)
      .use(diagramView)
      .use(htmlViews)
      .use(mathViews)
      .use(definitionView)
      .use(imageView)
      .use(codeBlockComponent)
      .use(linkTooltipPlugin)
      // Table chrome (FR-5.7): our own NodeView — the kit's component keeps
      // its overlays inside the table's scroll container, which is what gave
      // a table that fits a horizontal scrollbar.
      .use(tableView)
      .use(listItemBlockComponent)
      .use(history)
      .use(imagePastePlugin)
      .use(clipboard)
      .use(cursor)
      .use(indent)
      // M4 chrome: bubble menu (FR-5.4), slash menu (FR-5.5),
      // block handle + drop cursor (FR-5.6), empty-doc placeholder.
      .use(bubbleTooltip)
      .use(slashMenu)
      .use(block)
      .use(blockDropCursor)
      .use(placeholderPlugin)
      .use(findPlugin)
      .use(listA11yPlugin)
      .use(tableContextMenu)
      // A caret-sized way out of a document that ends in a table or a code
      // block (FR-5.6) — see plugins/trailing-paragraph.ts.
      .use(trailingParagraph)
      .use(trailingClickPlugin)
      .use(listener)
      .use(statePlugin)
      .create()
  );
}
