import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

/**
 * WYSIWYG find & replace (FR-9): a ProseMirror plugin holding the query and
 * match ranges, painting match decorations, plus imperative helpers the find
 * bar drives. Matches are found within single text nodes (v1 scope — good for
 * the vast majority of searches); the raw pane uses CodeMirror's richer search.
 */

export interface Match {
  from: number;
  to: number;
}

export interface FindState {
  query: string;
  caseSensitive: boolean;
  matches: Match[];
  active: number;
}

const EMPTY: FindState = { query: '', caseSensitive: false, matches: [], active: -1 };

export const findPluginKey = new PluginKey<FindState>('marknow-find');

interface FindMeta {
  query?: string;
  caseSensitive?: boolean;
  active?: number;
  clear?: boolean;
}

function computeMatches(doc: ProseNode, query: string, caseSensitive: boolean): Match[] {
  if (!query) return [];
  const needle = caseSensitive ? query : query.toLowerCase();
  const matches: Match[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const hay = caseSensitive ? node.text : node.text.toLowerCase();
    let idx = hay.indexOf(needle);
    while (idx !== -1) {
      matches.push({ from: pos + idx, to: pos + idx + query.length });
      idx = hay.indexOf(needle, idx + query.length);
    }
  });
  return matches;
}

export const findPlugin = $prose(
  () =>
    new Plugin<FindState>({
      key: findPluginKey,
      state: {
        init: () => EMPTY,
        apply(tr, prev) {
          const meta = tr.getMeta(findPluginKey) as FindMeta | undefined;
          if (meta?.clear) return EMPTY;
          if (meta && (meta.query !== undefined || meta.caseSensitive !== undefined)) {
            const query = meta.query ?? prev.query;
            const caseSensitive = meta.caseSensitive ?? prev.caseSensitive;
            const matches = computeMatches(tr.doc, query, caseSensitive);
            return { query, caseSensitive, matches, active: matches.length ? 0 : -1 };
          }
          if (meta?.active !== undefined) {
            return { ...prev, active: meta.active };
          }
          if (tr.docChanged && prev.query) {
            const matches = computeMatches(tr.doc, prev.query, prev.caseSensitive);
            const active = matches.length
              ? Math.min(Math.max(prev.active, 0), matches.length - 1)
              : -1;
            return { ...prev, matches, active };
          }
          return prev;
        },
      },
      props: {
        decorations(state) {
          const fs = findPluginKey.getState(state);
          if (!fs || fs.matches.length === 0) return null;
          return DecorationSet.create(
            state.doc,
            fs.matches.map((m, i) =>
              Decoration.inline(m.from, m.to, {
                class: i === fs.active ? 'pm-find-match pm-find-active' : 'pm-find-match',
              }),
            ),
          );
        },
      },
    }),
);

export function getFindState(view: EditorView): FindState {
  return findPluginKey.getState(view.state) ?? EMPTY;
}

function scrollActiveIntoView(view: EditorView) {
  const fs = getFindState(view);
  const m = fs.matches[fs.active];
  if (!m) return;
  const { node } = view.domAtPos(m.from);
  const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement);
  el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

export function setFindQuery(view: EditorView, query: string, caseSensitive: boolean): void {
  view.dispatch(view.state.tr.setMeta(findPluginKey, { query, caseSensitive }));
  scrollActiveIntoView(view);
}

export function findNext(view: EditorView): void {
  const fs = getFindState(view);
  if (fs.matches.length === 0) return;
  view.dispatch(
    view.state.tr.setMeta(findPluginKey, { active: (fs.active + 1) % fs.matches.length }),
  );
  scrollActiveIntoView(view);
}

export function findPrev(view: EditorView): void {
  const fs = getFindState(view);
  if (fs.matches.length === 0) return;
  const active = (fs.active - 1 + fs.matches.length) % fs.matches.length;
  view.dispatch(view.state.tr.setMeta(findPluginKey, { active }));
  scrollActiveIntoView(view);
}

export function replaceCurrent(view: EditorView, replacement: string): void {
  const fs = getFindState(view);
  const m = fs.matches[fs.active];
  if (!m) return;
  view.dispatch(view.state.tr.insertText(replacement, m.from, m.to));
  scrollActiveIntoView(view);
}

export function replaceAll(view: EditorView, replacement: string): void {
  const fs = getFindState(view);
  if (fs.matches.length === 0) return;
  let tr = view.state.tr;
  // Last → first so earlier positions stay valid as we edit.
  for (let i = fs.matches.length - 1; i >= 0; i--) {
    const m = fs.matches[i];
    tr = tr.insertText(replacement, m.from, m.to);
  }
  view.dispatch(tr);
}

export function closeFind(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(findPluginKey, { clear: true }));
}
