import type { EditorView as CmView } from '@codemirror/view';
import type { Editor } from '@milkdown/kit/core';
import {
  Bold,
  ChevronDown,
  Code,
  Image,
  Italic,
  Link,
  List,
  ListOrdered,
  ListTodo,
  MoreHorizontal,
  Redo2,
  Sigma,
  Strikethrough,
  Undo2,
} from 'lucide-react';

import { useMemo, useRef } from 'react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { createSourceToolbarCommands } from '@/editors/raw/toolbar-commands';
import { useRovingToolbar } from '@/lib/useRovingToolbar';
import { cn } from '@/lib/utils';

import { openSourcePopover } from './views/source-popover';
import type { BlockType, WysiwygSelectionState } from './selection-state';
import { TableSizePicker } from './TableSizePicker';
import { createRichToolbarCommands } from './toolbar-commands';
import { ToolbarButton } from './ToolbarButton';

const BLOCK_TYPE_LABELS: Record<BlockType, string> = {
  paragraph: 'Paragraph',
  h1: 'Heading 1',
  h2: 'Heading 2',
  h3: 'Heading 3',
  h4: 'Heading 4',
  h5: 'Heading 5',
  h6: 'Heading 6',
  quote: 'Quote',
  code: 'Code block',
  callout: 'Callout',
  other: 'Paragraph',
};

/** The source pane as an alternative toolbar target (dual mode). */
interface SourceTarget {
  /** Live CodeMirror view of the pane (null while mounting). */
  view: CmView | null;
  /** That pane's caret-context state, reflected while it is the target. */
  state: WysiwygSelectionState;
  /** True when the source pane was the last-focused pane. */
  active: boolean;
}

interface ToolbarProps {
  editor: Editor | null;
  state: WysiwygSelectionState;
  /**
   * Dual mode only: when `active`, every button drives the CodeMirror pane
   * as markdown text edits instead of Milkdown commands. Omitted in single
   * WYSIWYG mode, where the toolbar is Milkdown-only.
   */
  source?: SourceTarget;
}

function Divider() {
  return <div className="mx-1 h-5 w-px bg-border" aria-hidden />;
}

/**
 * Fixed formatting toolbar (FR-5.2) with selection-state reflection. In dual
 * mode it drives whichever pane the cursor was last in: the `source` prop
 * routes every action to the CodeMirror pane while that pane is the target,
 * through the shared `ToolbarCommands` adapter pair.
 */
export function WysiwygToolbar({ editor, state, source }: ToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  useRovingToolbar(toolbarRef);

  const sourceView = source?.active ? source.view : null;
  const commands = useMemo(
    () =>
      sourceView ? createSourceToolbarCommands(sourceView) : createRichToolbarCommands(editor),
    [sourceView, editor],
  );
  const shown = sourceView && source ? source.state : state;
  const disabled = sourceView ? false : editor === null;

  const insertImage = (anchor: HTMLElement) => {
    openSourcePopover({
      anchor,
      value: '',
      label: 'Image URL',
      multiline: false,
      placeholder: 'https://… or relative path',
      onApply: (src) => {
        if (src.trim()) commands.image(src.trim());
      },
    });
  };

  return (
    // Desktop: the sparse toolbar would leave a mostly-empty full-width bar,
    // so it floats instead as a centred island on the page surface — the same
    // design language as the page card, and on the app's centre axis (mode
    // switcher above, page below). Mobile keeps the edge-to-edge scrollable row.
    <div className="shrink-0 md:flex md:justify-center md:bg-muted/30 md:px-4 md:pt-3 md:pb-1">
      <div
        ref={toolbarRef}
        role="toolbar"
        aria-label="Formatting"
        className={cn(
          'flex items-center gap-0.5 border-b border-border bg-background px-2 py-1',
          // Mobile: one scrollable row of priority actions; desktop wraps.
          'flex-nowrap overflow-x-auto md:flex-wrap md:justify-center md:overflow-visible',
          'md:rounded-xl md:border md:px-1.5 md:shadow-sm',
          '[&>*]:shrink-0',
        )}
        data-testid="wysiwyg-toolbar"
      >
        <ToolbarButton label="Undo (Ctrl+Z)" disabled={disabled} onClick={() => commands.undo()}>
          <Undo2 className="size-4" />
        </ToolbarButton>
        <ToolbarButton label="Redo (Ctrl+Y)" disabled={disabled} onClick={() => commands.redo()}>
          <Redo2 className="size-4" />
        </ToolbarButton>

        <Divider />

        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={disabled}>
            <button
              type="button"
              aria-label="Block type"
              className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-sm hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
              data-testid="block-type-trigger"
            >
              {/* Fixed width: in a centred toolbar a label that resizes with the
                cursor's block type would shove every other button sideways. */}
              <span className="w-20 truncate text-left">{BLOCK_TYPE_LABELS[shown.blockType]}</span>
              <ChevronDown className="size-3.5 opacity-60" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {(
              ['paragraph', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'quote', 'code'] as BlockType[]
            ).map((type) => (
              <DropdownMenuItem key={type} onSelect={() => commands.setBlockType(type)}>
                {BLOCK_TYPE_LABELS[type]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Divider />

        <ToolbarButton
          label="Bold (Ctrl+B)"
          active={shown.strong}
          disabled={disabled}
          onClick={() => commands.strong()}
        >
          <Bold className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Italic (Ctrl+I)"
          active={shown.emphasis}
          disabled={disabled}
          onClick={() => commands.emphasis()}
        >
          <Italic className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Strikethrough (Ctrl+Shift+X)"
          active={shown.strikethrough}
          disabled={disabled}
          onClick={() => commands.strikethrough()}
        >
          <Strikethrough className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Inline code (Ctrl+E)"
          active={shown.inlineCode}
          disabled={disabled}
          onClick={() => commands.inlineCode()}
        >
          <Code className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Link (Ctrl+K)"
          active={shown.link}
          disabled={disabled}
          onClick={() => commands.link()}
        >
          <Link className="size-4" />
        </ToolbarButton>

        <Divider />

        <ToolbarButton
          label="Bullet list (Ctrl+Shift+8)"
          active={shown.bulletList && !shown.taskList}
          disabled={disabled}
          onClick={() => commands.bulletList()}
        >
          <List className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Numbered list (Ctrl+Shift+7)"
          active={shown.orderedList}
          disabled={disabled}
          onClick={() => commands.orderedList()}
        >
          <ListOrdered className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Task list (Ctrl+Shift+9)"
          active={shown.taskList}
          disabled={disabled}
          onClick={() => commands.taskList()}
        >
          <ListTodo className="size-4" />
        </ToolbarButton>

        <Divider />

        <TableSizePicker
          active={shown.inTable}
          disabled={disabled}
          onPick={(rows, cols) => commands.table(rows, cols)}
        />
        <ToolbarButton
          label="Insert image"
          disabled={disabled}
          onClick={() => {
            const anchor = document.querySelector<HTMLElement>('[data-testid="wysiwyg-toolbar"]');
            if (anchor) insertImage(anchor);
          }}
        >
          <Image className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Insert inline math"
          disabled={disabled}
          onClick={() => commands.mathInline()}
        >
          <Sigma className="size-4" />
        </ToolbarButton>

        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={disabled}>
            <button
              type="button"
              aria-label="More blocks"
              className="inline-flex size-8 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
              data-testid="toolbar-more"
            >
              <MoreHorizontal className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => commands.quote()}>
              Quote (Ctrl+Shift+B)
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => commands.callout()}>Callout</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => commands.divider()}>Divider</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => commands.mathBlock()}>Math block</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => commands.diagram()}>Mermaid diagram</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
