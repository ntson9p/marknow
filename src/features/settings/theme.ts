import { useSyncExternalStore } from 'react';
import { create } from 'zustand';

export type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'marknow.theme';

function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark' || value === 'system';
}

function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return theme;
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', resolveTheme(theme) === 'dark');
}

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

export const useThemeStore = create<ThemeState>()((set) => ({
  theme: 'system',
  setTheme: (theme) => {
    applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Storage unavailable (private mode etc.) — theme still applies for the session.
    }
    set({ theme });
  },
}));

/** React hook: the currently applied theme ('light' | 'dark'), reactive to pref + OS changes. */
export function useResolvedTheme(): 'light' | 'dark' {
  const theme = useThemeStore((s) => s.theme);
  const subscribe = (cb: () => void) => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', cb);
    return () => media.removeEventListener('change', cb);
  };
  const systemDark = useSyncExternalStore(subscribe, systemPrefersDark);
  if (theme === 'system') return systemDark ? 'dark' : 'light';
  return theme;
}

/** Read the persisted theme, apply it, and track OS-level changes while in `system`. */
export function initTheme() {
  const stored = (() => {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  })();
  const theme: Theme = isTheme(stored) ? stored : 'system';
  useThemeStore.setState({ theme });
  applyTheme(theme);

  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    if (useThemeStore.getState().theme === 'system') applyTheme('system');
  };
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}
