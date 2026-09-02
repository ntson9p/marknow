import type { Page } from '@playwright/test';

/**
 * Pin the persisted editor mode before the app boots (zustand persist shape).
 * Lifecycle specs pin 'dual' — its placeholder textarea survives until M5 and
 * keeps file-flow assertions editor-agnostic.
 */
export async function pinMode(page: Page, mode: 'raw' | 'wysiwyg' | 'dual') {
  await page.addInitScript((m) => {
    // Init scripts re-run on reload; only seed once so in-app mode changes
    // (and their persistence) still win afterwards.
    if (window.localStorage.getItem('__pinModeApplied')) return;
    window.localStorage.setItem('__pinModeApplied', '1');
    const raw = window.localStorage.getItem('marknow.ui');
    const persisted = raw ? (JSON.parse(raw) as { state: Record<string, unknown> }) : { state: {} };
    persisted.state = { ...persisted.state, mode: m };
    window.localStorage.setItem('marknow.ui', JSON.stringify({ version: 0, ...persisted }));
  }, mode);
}

/**
 * Stub the File System Access API with an in-page fake so save/open flows are
 * deterministic and cross-browser (pickers cannot be automated). The fake
 * "disk" lives on window.__fsaFiles: Record<name, content>.
 */
export async function stubFsa(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    const files: Record<string, string> = (w.__fsaFiles as Record<string, string>) ?? {};
    w.__fsaFiles = files;

    function makeHandle(name: string) {
      return {
        kind: 'file',
        name,
        queryPermission: async () => 'granted',
        requestPermission: async () => 'granted',
        isSameEntry: async () => false,
        getFile: async () => ({
          name,
          text: async () => files[name] ?? '',
        }),
        createWritable: async () => ({
          write: async (text: string) => {
            files[name] = text;
          },
          close: async () => {},
        }),
      };
    }
    w.__makeFsaHandle = makeHandle;

    w.showSaveFilePicker = async (opts?: { suggestedName?: string }) =>
      makeHandle(opts?.suggestedName ?? 'untitled.md');
    w.showOpenFilePicker = async () => {
      const name = (w.__openFileName as string) ?? 'sample.md';
      return [makeHandle(name)];
    };
  });
}

/** Pin the theme before boot so contrast scans are deterministic. */
export async function pinTheme(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript((t) => {
    window.localStorage.setItem('marknow.theme', t);
  }, theme);
}

export async function getFakeDisk(page: Page): Promise<Record<string, string>> {
  return page.evaluate(
    () => (window as unknown as { __fsaFiles: Record<string, string> }).__fsaFiles,
  );
}

export async function seedFakeFile(page: Page, name: string, content: string) {
  await page.addInitScript(
    ([n, c]) => {
      const w = window as unknown as Record<string, unknown>;
      const files: Record<string, string> = (w.__fsaFiles as Record<string, string>) ?? {};
      files[n] = c;
      w.__fsaFiles = files;
      w.__openFileName = n;
    },
    [name, content] as const,
  );
}
