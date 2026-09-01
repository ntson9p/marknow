import { $remark } from '@milkdown/kit/utils';
import type { Code, Html, Root } from 'mdast';
import remarkMath from 'remark-math';
import { visit } from 'unist-util-visit';

import { remarkCalloutNodes } from '@/core/markdown/callouts';
import { remarkHtmlBlocks } from '@/core/markdown/html-blocks';

/**
 * The WYSIWYG parse path extensions, mirroring the shared grammar
 * (`core/markdown/parse.ts`): math + callouts. GFM comes from Milkdown's
 * preset-gfm (same remark-gfm underneath); frontmatter never reaches the
 * WYSIWYG editor (split at the store boundary, FR-5.12).
 */
export const remarkMathPlugin = $remark('remarkMath', () => remarkMath);

/** Blockquote callouts → first-class `callout` mdast nodes (FR-5.10). */
export const remarkCalloutPlugin = $remark('remarkCalloutNodes', () => remarkCalloutNodes);

/** Block-position raw HTML → `htmlBlock` mdast nodes for the chip schema (FR-5.11). */
export const remarkHtmlBlockPlugin = $remark('remarkHtmlBlocks', () => remarkHtmlBlocks);

/**
 * ```mermaid fences → `diagram` mdast nodes (FR-5.9). Re-tagging at parse
 * time keeps the diagram schema's matcher disjoint from the generic code
 * block regardless of schema registration order.
 */
export function remarkDiagrams() {
  return (tree: Root) => {
    visit(tree, 'code', (node: Code) => {
      if (node.lang === 'mermaid') {
        (node as unknown as { type: string }).type = 'diagram';
      }
    });
  };
}

export const remarkDiagramPlugin = $remark('remarkDiagrams', () => remarkDiagrams);

/** Only these spellings are a line break; anything else stays verbatim HTML. */
const BR = /^<br\s*\/?>$/i;

/**
 * `<br>` inside a table cell → `tableBreak` nodes for the schema (FR-5.7).
 *
 * Confined to cells on purpose. Everywhere else markdown has a native line
 * break, so a `<br>` an author typed is HTML they meant, and D13 rule 3 keeps
 * it verbatim in a chip. Inside a cell there is no native break, which makes
 * `<br>` the line break rather than a piece of markup about one.
 *
 * The re-tag happens here rather than through parser precedence for the reason
 * the module header gives: matcher conflicts are settled on the mdast type.
 */
export function remarkTableBreaks() {
  return (tree: Root) => {
    visit(tree, 'tableCell', (cell) => {
      // Nested, not over `cell.children`: a break can sit inside emphasis.
      visit(cell, 'html', (node: Html) => {
        if (BR.test(node.value.trim())) {
          (node as unknown as { type: string }).type = 'tableBreak';
        }
      });
    });
  };
}

export const remarkTableBreakPlugin = $remark('remarkTableBreaks', () => remarkTableBreaks);

export const wysiwygRemarkPlugins = [
  remarkMathPlugin,
  remarkCalloutPlugin,
  remarkHtmlBlockPlugin,
  remarkDiagramPlugin,
  remarkTableBreakPlugin,
].flat();
