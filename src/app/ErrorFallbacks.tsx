import { AlertTriangle } from 'lucide-react';

import { Button } from '@/components/ui/button';

function ErrorDetail({ error }: { error: Error }) {
  return (
    <pre className="max-w-md overflow-auto rounded bg-muted p-2 text-left text-xs text-muted-foreground">
      {error.message || String(error)}
    </pre>
  );
}

/** Last-resort full-page crash screen (top-level boundary). */
export function AppCrashFallback({ error }: { error: Error; reset: () => void }) {
  return (
    <div
      role="alert"
      className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center"
    >
      <AlertTriangle className="size-10 text-destructive" aria-hidden />
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          MarkNow hit an unexpected error. Your most recent document is kept as a recoverable draft
          — reload to pick up where you left off.
        </p>
      </div>
      <Button onClick={() => window.location.reload()}>Reload MarkNow</Button>
      <ErrorDetail error={error} />
    </div>
  );
}

/** Editor-pane crash fallback — the shell (menu, save) stays usable. */
export function EditorCrashFallback({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div
      role="alert"
      className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center"
    >
      <AlertTriangle className="size-8 text-destructive" aria-hidden />
      <div className="space-y-1">
        <p className="font-medium">The editor ran into a problem</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Your text is safe. Try again, switch editing modes, or save your work from the menu.
        </p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={reset}>
          Try again
        </Button>
        <Button onClick={() => window.location.reload()}>Reload</Button>
      </div>
      <ErrorDetail error={error} />
    </div>
  );
}
