import { commandsCtx, editorViewCtx } from '@milkdown/kit/core';
import type { CmdKey } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import {
  createCodeBlockCommand,
  insertHrCommand,
  insertImageCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from '@milkdown/kit/preset/commonmark';
import { insertTableCommand } from '@milkdown/kit/preset/gfm';
import { slashFactory, SlashProvider } from '@milkdown/kit/plugin/slash';
import { TextSelection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';

import {
  insertDiagramCommand,
  insertMathBlockCommand,
  toggleTaskListCommand,
  wrapInCalloutCommand,
} from '../commands';
import { openSourcePopover } from '../views/source-popover';
import { icons } from './icons';

/**
 * Slash commands (FR-5.5): typing `/` at a paragraph/heading opens a
 * filterable, keyboard-first insert menu. Built on the slash plugin; keyboard
 * navigation lives in the same plugin's `handleKeyDown` so it is correctly
 * scoped to the editor view.
 */
export const slashMenu = slashFactory('marknow-slash');

/** Non-whitespace placeholder for atom leaves when scanning the block text. */
const ATOM_LEAF = String.fromCharCode(0xfffc);

interface SlashItem {
  label: string;
  description: string;
  keywords: string[];
  icon: string;
  /** Runs after the `/query` text has been removed from the document. */
  run: (ctx: Ctx) => void;
}

const call =
  <T>(command: { key: CmdKey<T> }, payload?: T) =>
  (ctx: Ctx) =>
    void ctx.get(commandsCtx).call(command.key, payload);

const SLASH_ITEMS: SlashItem[] = [
  {
    label: 'Heading 1',
    description: 'Big section heading',
    keywords: ['h1', 'title'],
    icon: icons.heading1,
    run: call(wrapInHeadingCommand, 1),
  },
  {
    label: 'Heading 2',
    description: 'Medium section heading',
    keywords: ['h2'],
    icon: icons.heading2,
    run: call(wrapInHeadingCommand, 2),
  },
  {
    label: 'Heading 3',
    description: 'Small section heading',
    keywords: ['h3'],
    icon: icons.heading3,
    run: call(wrapInHeadingCommand, 3),
  },
  {
    label: 'Bullet list',
    description: 'Unordered list',
    keywords: ['ul', 'unordered', 'bullet'],
    icon: icons.list,
    run: call(wrapInBulletListCommand),
  },
  {
    label: 'Numbered list',
    description: 'Ordered list',
    keywords: ['ol', 'ordered', 'number'],
    icon: icons.listOrdered,
    run: call(wrapInOrderedListCommand),
  },
  {
    label: 'Task list',
    description: 'Checkbox to-do list',
    keywords: ['todo', 'task', 'checkbox'],
    icon: icons.listTodo,
    run: call(toggleTaskListCommand),
  },
  {
    label: 'Quote',
    description: 'Blockquote',
    keywords: ['blockquote', 'quote'],
    icon: icons.quote,
    run: call(wrapInBlockquoteCommand),
  },
  {
    label: 'Callout',
    description: 'Highlighted note box',
    keywords: ['callout', 'note', 'admonition', 'aside'],
    icon: icons.callout,
    run: call(wrapInCalloutCommand, 'note'),
  },
  {
    label: 'Code block',
    description: 'Code with syntax highlighting',
    keywords: ['code', 'fence', 'pre'],
    icon: icons.braces,
    run: call(createCodeBlockCommand),
  },
  {
    label: 'Table',
    description: 'Insert a table',
    keywords: ['table', 'grid'],
    icon: icons.table,
    run: call(insertTableCommand, { row: 3, col: 3 }),
  },
  {
    label: 'Math block',
    description: 'KaTeX block equation',
    keywords: ['math', 'latex', 'katex', 'equation'],
    icon: icons.sigma,
    run: call(insertMathBlockCommand, ''),
  },
  {
    label: 'Mermaid',
    description: 'Diagram from text',
    keywords: ['mermaid', 'diagram', 'flowchart'],
    icon: icons.workflow,
    run: call(insertDiagramCommand),
  },
  {
    label: 'Divider',
    description: 'Horizontal rule',
    keywords: ['hr', 'divider', 'rule', 'separator'],
    icon: icons.minus,
    run: call(insertHrCommand),
  },
  {
    label: 'Image',
    description: 'Insert an image by URL',
    keywords: ['image', 'picture', 'photo'],
    icon: icons.image,
    run: (ctx) => {
      const anchor = document.querySelector<HTMLElement>('.wysiwyg-root') ?? document.body;
      openSourcePopover({
        anchor,
        value: '',
        label: 'Image URL',
        multiline: false,
        placeholder: 'https://… or relative path',
        onApply: (src) => {
          if (src.trim()) ctx.get(commandsCtx).call(insertImageCommand.key, { src: src.trim() });
        },
      });
    },
  },
];

function matches(item: SlashItem, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    item.label.toLowerCase().includes(q) || item.keywords.some((k) => k.toLowerCase().includes(q))
  );
}

class SlashMenuView {
  readonly #ctx: Ctx;
  readonly #content: HTMLElement;
  readonly #list: HTMLElement;
  readonly #empty: HTMLElement;
  readonly #provider: SlashProvider;
  #filtered: SlashItem[] = [];
  #activeIndex = 0;
  #queryLen = 0;
  /** Sentinel distinct from any real query so the first match resets the index. */
  #lastQuery = ' ';
  /** `${blockStart}:${query}` dismissed by Escape until the context changes. */
  #dismissedKey: string | null = null;

  constructor(ctx: Ctx, view: EditorView) {
    this.#ctx = ctx;
    const content = document.createElement('div');
    content.className = 'milkdown-slash-menu';
    content.setAttribute('role', 'listbox');
    content.setAttribute('aria-label', 'Insert block');
    content.addEventListener('mousedown', (e) => e.preventDefault());
    this.#content = content;

    this.#list = document.createElement('div');
    this.#list.className = 'slash-list';
    content.appendChild(this.#list);

    this.#empty = document.createElement('div');
    this.#empty.className = 'slash-empty';
    this.#empty.textContent = 'No matches';
    content.appendChild(this.#empty);

    this.#provider = new SlashProvider({
      content,
      debounce: 20,
      offset: 8,
      shouldShow: (v) => this.#shouldShow(v),
      floatingUIOptions: { strategy: 'fixed' },
    });

    this.update(view);
  }

  #shouldShow(view: EditorView): boolean {
    const { state } = view;
    const { selection } = state;
    const { empty, $from } = selection;
    if (!(selection instanceof TextSelection) || !empty || !view.editable) return false;
    if (!view.hasFocus() && !this.#content.contains(document.activeElement)) return false;

    const parent = $from.parent;
    if (parent.type.name !== 'paragraph' && parent.type.name !== 'heading') return false;

    const textBefore = parent.textBetween(0, $from.parentOffset, undefined, ATOM_LEAF);
    const slashIdx = textBefore.lastIndexOf('/');
    if (slashIdx === -1) return false;
    // The `/` must begin the block or follow whitespace.
    const before = slashIdx === 0 ? '' : textBefore[slashIdx - 1];
    if (before && !/\s/.test(before)) return false;
    const query = textBefore.slice(slashIdx + 1);
    if (/\s/.test(query)) return false; // a space ends the trigger

    const key = `${$from.before()}:${query}`;
    if (this.#dismissedKey === key) return false;
    this.#dismissedKey = null;

    const filtered = SLASH_ITEMS.filter((item) => matches(item, query));
    if (filtered.length === 0) return false;

    if (query !== this.#lastQuery) this.#activeIndex = 0;
    this.#lastQuery = query;
    this.#queryLen = query.length;
    this.#filtered = filtered;
    this.#renderList();
    return true;
  }

  #renderList() {
    this.#list.replaceChildren();
    this.#activeIndex = Math.max(0, Math.min(this.#activeIndex, this.#filtered.length - 1));
    this.#filtered.forEach((item, index) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'slash-item';
      el.setAttribute('role', 'option');
      el.setAttribute('aria-selected', String(index === this.#activeIndex));
      if (index === this.#activeIndex) el.classList.add('active');
      el.innerHTML = `<span class="slash-item-icon">${item.icon}</span><span class="slash-item-text"><span class="slash-item-label">${item.label}</span><span class="slash-item-desc">${item.description}</span></span>`;
      // `mousemove`, not `mouseenter`: a resting cursor the freshly-positioned
      // menu happens to open under must not hijack the keyboard selection.
      el.addEventListener('mousemove', () => this.#setActive(index));
      el.addEventListener('click', () => this.#runItem(index));
      this.#list.appendChild(el);
    });
  }

  #setActive(index: number) {
    if (index < 0 || index >= this.#filtered.length) return;
    this.#activeIndex = index;
    const items = this.#list.children;
    for (let i = 0; i < items.length; i++) {
      const el = items[i] as HTMLElement;
      const active = i === index;
      el.classList.toggle('active', active);
      el.setAttribute('aria-selected', String(active));
      if (active) el.scrollIntoView({ block: 'nearest' });
    }
  }

  #runItem(index: number) {
    const item = this.#filtered[index];
    if (!item) return;
    const view = this.#ctx.get(editorViewCtx);
    const { state } = view;
    const { $from } = state.selection;
    const deleteFrom = Math.max(0, $from.pos - (this.#queryLen + 1)); // include the `/`
    view.dispatch(state.tr.delete(deleteFrom, $from.pos));
    item.run(this.#ctx);
    view.focus();
    this.#provider.hide();
    this.#dismissedKey = null;
  }

  /** Keyboard navigation while the menu is open (wired via plugin props). */
  handleKeyDown(_view: EditorView, event: KeyboardEvent): boolean {
    if (this.#content.dataset.show !== 'true' || this.#filtered.length === 0) return false;
    const count = this.#filtered.length;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.#setActive((this.#activeIndex + 1) % count);
        return true;
      case 'ArrowUp':
        event.preventDefault();
        this.#setActive((this.#activeIndex - 1 + count) % count);
        return true;
      case 'Enter':
        event.preventDefault();
        this.#runItem(this.#activeIndex);
        return true;
      case 'Tab':
        event.preventDefault();
        this.#setActive(
          event.shiftKey
            ? (this.#activeIndex - 1 + count) % count
            : (this.#activeIndex + 1) % count,
        );
        return true;
      case 'Escape': {
        event.preventDefault();
        // Remember the current trigger so it stays closed until it changes.
        const { $from } = this.#ctx.get(editorViewCtx).state.selection;
        const q = this.#lastQuery === ' ' ? '' : this.#lastQuery;
        this.#dismissedKey = `${$from.before()}:${q}`;
        this.#provider.hide();
        return true;
      }
      default:
        return false;
    }
  }

  update(view: EditorView) {
    this.#provider.update(view);
  }

  destroy() {
    this.#provider.destroy();
    this.#content.remove();
  }
}

export function configureSlashMenu(ctx: Ctx) {
  let instance: SlashMenuView | null = null;
  ctx.set(slashMenu.key, {
    view: (view: EditorView) => {
      instance = new SlashMenuView(ctx, view);
      return instance;
    },
    props: {
      handleKeyDown: (view: EditorView, event: KeyboardEvent) =>
        instance ? instance.handleKeyDown(view, event) : false,
    },
  });
}
