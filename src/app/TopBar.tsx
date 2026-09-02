import { Columns2, PanelLeft, Settings } from 'lucide-react';

import { MainMenu } from '@/app/MainMenu';
import { ModeSwitcher } from '@/app/ModeSwitcher';
import { ThemeToggle } from '@/app/ThemeToggle';
import { Button } from '@/components/ui/button';
import { useDocStore } from '@/core/document/store';
import { useUiStore } from '@/app/store/ui';

export function TopBar() {
  const status = useDocStore((s) => s.status);
  const dirty = useDocStore((s) => s.dirty);
  const fileName = useDocStore((s) => s.file?.name);
  const mode = useUiStore((s) => s.mode);
  const previewVisible = useUiStore((s) => s.rawPreviewVisible);
  const togglePreview = useUiStore((s) => s.toggleRawPreview);
  const outlineVisible = useUiStore((s) => s.outlineVisible);
  const toggleOutline = useUiStore((s) => s.toggleOutline);
  const setActivePanel = useUiStore((s) => s.setActivePanel);

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-background px-2">
      <MainMenu />
      {status === 'open' && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={outlineVisible ? 'Hide outline' : 'Show outline'}
          aria-pressed={outlineVisible}
          title="Toggle outline (Ctrl+Shift+O)"
          onClick={toggleOutline}
          data-testid="outline-toggle"
        >
          <PanelLeft className={outlineVisible ? 'size-4' : 'size-4 opacity-50'} />
        </Button>
      )}
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="truncate text-sm font-medium" data-testid="doc-title">
          {status === 'open' ? (fileName ?? 'Untitled') : 'MarkNow'}
        </span>
        {status === 'open' && dirty && (
          <span
            className="size-2 shrink-0 rounded-full bg-primary"
            role="status"
            aria-label="Unsaved changes"
            data-testid="dirty-dot"
          />
        )}
      </div>
      <div className="flex flex-1 justify-center">{status === 'open' && <ModeSwitcher />}</div>
      {status === 'open' && mode === 'raw' && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={previewVisible ? 'Hide preview' : 'Show preview'}
          aria-pressed={previewVisible}
          title="Toggle preview (Ctrl+Shift+P)"
          onClick={togglePreview}
          data-testid="preview-toggle"
        >
          <Columns2 className={previewVisible ? 'size-4' : 'size-4 opacity-50'} />
        </Button>
      )}
      {/* Next to the theme toggle, the other app-level preference: both are
          "how MarkNow behaves", not "what this document is". */}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Settings"
        title="Settings (Ctrl+,)"
        onClick={() => setActivePanel('settings')}
        data-testid="settings-open"
      >
        <Settings className="size-4" />
      </Button>
      <ThemeToggle />
    </header>
  );
}
