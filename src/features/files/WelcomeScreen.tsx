import { useEffect, useState, type ComponentType } from 'react';
import {
  Clock,
  FilePlus2,
  FileText,
  FolderOpen,
  Keyboard,
  ShieldCheck,
  Upload,
} from 'lucide-react';

import { useUiStore } from '@/app/store/ui';
import { GitHubMark } from '@/components/GitHubMark';
import { REPO_URL } from '@/lib/links';
import { cn } from '@/lib/utils';
import type { DraftRecord, RecentRecord } from '@/core/storage/db';
import { newDocument, openDocument, openRecent } from '@/features/files/actions';
import { listRecents } from '@/features/files/recents';
import { RecoveryBanner } from '@/features/files/RecoveryBanner';
import { discardDraft, findRecoveryCandidate, restoreDraft } from '@/features/files/recovery';

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days <= 7) return `${days} d ago`;
  return new Date(ts).toLocaleDateString();
}

/**
 * A key combo as <kbd> chips. `className` carries the palette so the same chip
 * works on the card surface and on the filled primary tile.
 */
function Keys({ combo, className }: { combo: string; className?: string }) {
  return (
    <span className="flex items-center gap-0.5" aria-hidden>
      {combo.split('+').map((k) => (
        <kbd
          key={k}
          className={cn(
            'rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px] leading-none text-muted-foreground',
            className,
          )}
        >
          {k}
        </kbd>
      ))}
    </span>
  );
}

interface ActionTileProps {
  icon: ComponentType<{ className?: string }>;
  title: string;
  hint: string;
  keys: string;
  primary?: boolean;
  onClick: () => void;
  testId: string;
}

/**
 * The two entry points into the app. Rendered as tiles rather than plain
 * buttons: on an otherwise empty screen they are the only thing to do, so they
 * carry the weight — and the shortcut chip teaches the keyboard path for the
 * second visit.
 */
function ActionTile({ icon: Icon, title, hint, keys, primary, onClick, testId }: ActionTileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={cn(
        'group flex items-center gap-3 rounded-xl border p-3.5 text-left transition-colors outline-none',
        'focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
        primary
          ? 'border-transparent bg-primary text-primary-foreground shadow-sm hover:bg-primary/90'
          : 'bg-card shadow-xs hover:border-primary/40 hover:bg-accent',
      )}
    >
      <span
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-lg',
          primary ? 'bg-primary-foreground/15' : 'bg-primary/10 text-primary',
        )}
      >
        <Icon className="size-4.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        <span className={cn('block truncate text-xs', primary ? '' : 'text-muted-foreground')}>
          {hint}
        </span>
      </span>
      <Keys
        combo={keys}
        className={cn(
          'max-sm:hidden',
          primary && 'border-primary-foreground/30 bg-transparent text-primary-foreground',
        )}
      />
    </button>
  );
}

/** Highlight the screen while a file is dragged anywhere over the window (FR-1.8). */
function useDragHighlight(): boolean {
  const [over, setOver] = useState(false);
  useEffect(() => {
    // Drag events fire per element, so enter/leave are counted: leaving a child
    // for its parent must not clear the highlight.
    let depth = 0;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types?.includes('Files') ?? false;
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth += 1;
      setOver(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setOver(false);
    };
    const reset = () => {
      depth = 0;
      setOver(false);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', reset);
    window.addEventListener('dragend', reset);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', reset);
      window.removeEventListener('dragend', reset);
    };
  }, []);
  return over;
}

/** First-run copy for the side panel: what the app is, before there is anything to reopen. */
const CAPABILITIES = [
  'Three modes — raw source, rich text, or both side by side.',
  'Tables, callouts, footnotes and Mermaid diagrams.',
  'Autosaved drafts, so a closed tab never costs you work.',
];

function RecentsPanel({ recents }: { recents: RecentRecord[] }) {
  return (
    <aside className="rounded-xl border bg-card p-2 shadow-xs" aria-labelledby="recents-heading">
      <h2
        id="recents-heading"
        className="px-2 pt-1.5 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
      >
        {recents.length > 0 ? 'Recent files' : 'What you can do here'}
      </h2>

      {recents.length > 0 ? (
        <ul data-testid="recents-list">
          {recents.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60"
                onClick={() => void openRecent(r.handle)}
              >
                <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{r.name}</span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="size-3 shrink-0" aria-hidden />
                    <span className="truncate">
                      {relativeTime(r.lastOpenedAt)} · {r.pathHint}
                    </span>
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="space-y-2 px-2 pt-1 pb-2">
          {CAPABILITIES.map((line) => (
            <li key={line} className="flex gap-2 text-sm text-muted-foreground">
              <span className="mt-2 size-1 shrink-0 rounded-full bg-primary" aria-hidden />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

export function WelcomeScreen() {
  const [recents, setRecents] = useState<RecentRecord[]>([]);
  const [draft, setDraft] = useState<DraftRecord | null>(null);
  const setActivePanel = useUiStore((s) => s.setActivePanel);
  const dragging = useDragHighlight();

  useEffect(() => {
    void listRecents().then(setRecents);
    void findRecoveryCandidate().then(setDraft);
  }, []);

  return (
    <div className="relative flex h-full min-h-0 w-full flex-1 flex-col overflow-y-auto bg-surface">
      {/* A soft wash behind the mark so the screen reads as a considered start
          page rather than a card dropped on a flat background. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(60%_100%_at_30%_0%,var(--primary)_0%,transparent_70%)] opacity-[0.07]"
      />

      <div className="relative mx-auto flex min-h-full w-full max-w-4xl flex-col justify-start gap-6 px-6 py-10 md:justify-center">
        {draft && (
          <RecoveryBanner
            draft={draft}
            onRestore={() => {
              restoreDraft(draft);
              setDraft(null);
            }}
            onDiscard={() => {
              void discardDraft(draft);
              setDraft(null);
            }}
          />
        )}

        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_20rem] md:items-start md:gap-8">
          <section className="flex flex-col">
            <div className="flex items-center gap-3">
              <img src="/favicon.svg" alt="" className="size-10 rounded-xl shadow-sm" />
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">MarkNow</h1>
            </div>
            <p className="mt-3 max-w-md text-[15px] leading-relaxed text-muted-foreground">
              Write markdown the way you like it — raw source, rich text, or both side by side,
              straight from the files on your disk.
            </p>

            <div className="mt-6 grid gap-2.5">
              <ActionTile
                icon={FilePlus2}
                title="New document"
                hint="Start with a blank page"
                keys="Ctrl+Alt+N"
                primary
                onClick={newDocument}
                testId="welcome-new"
              />
              <ActionTile
                icon={FolderOpen}
                title="Open…"
                hint="Pick a .md file from your computer"
                keys="Ctrl+O"
                onClick={() => void openDocument()}
                testId="welcome-open"
              />
            </div>

            <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
              <Upload className="size-3.5 shrink-0" aria-hidden />
              Or drop a .md file anywhere in this window.
            </p>
          </section>

          <RecentsPanel recents={recents} />
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t pt-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
            Nothing is uploaded — your files stay local.
          </span>
          <button
            type="button"
            onClick={() => setActivePanel('shortcuts')}
            className="flex items-center gap-1.5 rounded-sm underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <Keyboard className="size-3.5 shrink-0" aria-hidden />
            Keyboard shortcuts
            <Keys combo="Ctrl+/" />
          </button>
          {/* Last in the row, and deliberately in the same breath as the
              privacy claim above: "nothing is uploaded" is a promise, and the
              source is the only thing that turns it into something checkable. */}
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            data-testid="welcome-source"
            className="flex items-center gap-1.5 rounded-sm underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <GitHubMark className="size-3.5 shrink-0" />
            Source on GitHub
          </a>
        </div>
      </div>

      {dragging && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-3 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary bg-surface/92"
        >
          <span className="flex items-center gap-2 rounded-full border border-primary/40 bg-card px-4 py-2 text-sm font-medium shadow-lg">
            <Upload className="size-4 text-primary" />
            Drop to open
          </span>
        </div>
      )}
    </div>
  );
}
