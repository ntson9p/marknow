import type { MouseEvent, ReactNode, Ref } from 'react';

import { cn } from '@/lib/utils';

export interface ToolbarButtonProps {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
  ref?: Ref<HTMLButtonElement>;
  /**
   * Set only by buttons that open a panel (the table size picker): adds the
   * popup-trigger ARIA the plain action buttons must not carry.
   */
  expanded?: boolean;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
}

/**
 * One control in the formatting toolbar. Its own module because the table size
 * picker (which owns its trigger, so hover/click/keyboard state stays in one
 * place) needs the same chrome as every other button.
 */
export function ToolbarButton({
  label,
  active = false,
  disabled = false,
  onClick,
  children,
  ref,
  expanded,
  onPointerEnter,
  onPointerLeave,
}: ToolbarButtonProps) {
  return (
    <button
      type="button"
      ref={ref}
      aria-label={label}
      title={label}
      aria-pressed={active}
      aria-haspopup={expanded === undefined ? undefined : 'dialog'}
      aria-expanded={expanded}
      disabled={disabled}
      // Keep focus in the editor; commands act on the current selection.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      className={cn(
        'inline-flex size-8 items-center justify-center rounded-md text-sm transition-colors',
        'hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active && 'bg-accent text-accent-foreground',
      )}
    >
      {children}
    </button>
  );
}
