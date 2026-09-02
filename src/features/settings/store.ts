import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { DEFAULT_STYLE_PREFS, type MarkdownStylePrefs } from '@/core/markdown/style';
import type { EditorMode } from '@/app/store/ui';

/** User settings (FR-13), persisted to `marknow.settings` in localStorage. */
interface SettingsState {
  /** Drives D13 normalization (FR-13.2). */
  markdownStyle: MarkdownStylePrefs;
  /** Editor preferences (FR-13.3). */
  fontSize: number;
  lineNumbers: boolean;
  defaultMode: EditorMode;
  draftIntervalMs: number;
  /**
   * Let a diagram too wide for its column scroll instead of shrinking (FR-5.9).
   *
   * Off by default: scaling to fit keeps the document a single scrollable
   * surface, which is what most people expect of a page. Turning it on trades
   * that for legibility — a very wide diagram (disconnected subgraphs get laid
   * out side by side) otherwise renders at ~0.3 and its labels are unreadable.
   */
  diagramScroll: boolean;

  setMarkdownStyle: (patch: Partial<MarkdownStylePrefs>) => void;
  setFontSize: (px: number) => void;
  setLineNumbers: (on: boolean) => void;
  setDefaultMode: (mode: EditorMode) => void;
  setDraftIntervalMs: (ms: number) => void;
  setDiagramScroll: (on: boolean) => void;
  resetToDefaults: () => void;
}

const DEFAULTS = {
  markdownStyle: DEFAULT_STYLE_PREFS,
  fontSize: 14,
  lineNumbers: true,
  defaultMode: 'wysiwyg' as EditorMode,
  draftIntervalMs: 1000,
  diagramScroll: false,
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      setMarkdownStyle: (patch) =>
        set((s) => ({ markdownStyle: { ...s.markdownStyle, ...patch } })),
      setFontSize: (fontSize) => set({ fontSize }),
      setLineNumbers: (lineNumbers) => set({ lineNumbers }),
      setDefaultMode: (defaultMode) => set({ defaultMode }),
      setDraftIntervalMs: (draftIntervalMs) => set({ draftIntervalMs }),
      setDiagramScroll: (diagramScroll) => set({ diagramScroll }),
      resetToDefaults: () => set({ ...DEFAULTS }),
    }),
    {
      name: 'marknow.settings',
      // Deep-merge markdownStyle so settings persisted before a new style
      // pref existed (e.g. tableAlign) pick up its default instead of
      // rehydrating `undefined` into a controlled input.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SettingsState>;
        return {
          ...current,
          ...p,
          markdownStyle: { ...current.markdownStyle, ...(p.markdownStyle ?? {}) },
        };
      },
    },
  ),
);
