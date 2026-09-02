import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** The three editing modes (FR-2.1). */
export type EditorMode = 'raw' | 'wysiwyg' | 'dual';

/**
 * WYSIWYG page measure, in `ch` (§8.1: a centred Docs-like page). Stored in
 * `ch` rather than pixels so the line length a user picks survives a font-size
 * change (FR-13.3) — it is a typographic measure, not a box size.
 */
export const DEFAULT_MEASURE_CH = 72;
export const MIN_MEASURE_CH = 40;
export const MAX_MEASURE_CH = 160;

export const clampMeasure = (ch: number) =>
  Math.round(Math.min(MAX_MEASURE_CH, Math.max(MIN_MEASURE_CH, ch)));

interface UiState {
  /** Default is WYSIWYG (D3); last-used mode persists per device (FR-2.3). */
  mode: EditorMode;
  setMode: (mode: EditorMode) => void;

  /** Raw-mode preview column visibility (FR-3.3, Ctrl+Shift+P). */
  rawPreviewVisible: boolean;
  toggleRawPreview: () => void;

  /** Outline sidebar visibility (FR-10.1, Ctrl+Shift+O). */
  outlineVisible: boolean;
  toggleOutline: () => void;

  /** Persisted splitter ratios (FR-2.3/FR-2.4). */
  rawSplit: number;
  setRawSplit: (ratio: number) => void;
  dualSplit: number;
  setDualSplit: (ratio: number) => void;

  /** WYSIWYG page width in `ch` (FR-2.3: layout sizes persist per device). */
  wysiwygMeasure: number;
  setWysiwygMeasure: (ch: number) => void;
  resetWysiwygMeasure: () => void;

  /** Source/preview split of the mermaid editor (FR-5.9); persisted like the others. */
  diagramSplit: number;
  setDiagramSplit: (ratio: number) => void;

  /** Cursor position for the status bar (FR-10.3); not persisted. */
  cursor: { line: number; col: number } | null;
  setCursor: (cursor: { line: number; col: number } | null) => void;

  /** The open modal panel (metadata/history/export/settings/shortcuts/diff), if any; not persisted. */
  activePanel: 'metadata' | 'history' | 'export' | 'settings' | 'shortcuts' | 'diff' | null;
  setActivePanel: (panel: UiState['activePanel']) => void;

  /** Review Changes layout: side-by-side or unified; persisted like the mode. */
  diffLayout: 'split' | 'unified';
  setDiffLayout: (layout: 'split' | 'unified') => void;
  /** Collapse unchanged regions in the diff; persisted. */
  diffCollapse: boolean;
  toggleDiffCollapse: () => void;
  /** Soft-wrap long lines in the diff; persisted. Markdown prose wants this on. */
  diffWrap: boolean;
  toggleDiffWrap: () => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      mode: 'wysiwyg',
      setMode: (mode) => set({ mode }),

      rawPreviewVisible: true,
      toggleRawPreview: () => set((s) => ({ rawPreviewVisible: !s.rawPreviewVisible })),

      outlineVisible: false,
      toggleOutline: () => set((s) => ({ outlineVisible: !s.outlineVisible })),

      rawSplit: 0.5,
      setRawSplit: (rawSplit) => set({ rawSplit }),
      dualSplit: 0.5,
      setDualSplit: (dualSplit) => set({ dualSplit }),

      wysiwygMeasure: DEFAULT_MEASURE_CH,
      setWysiwygMeasure: (ch) => set({ wysiwygMeasure: clampMeasure(ch) }),
      resetWysiwygMeasure: () => set({ wysiwygMeasure: DEFAULT_MEASURE_CH }),

      diagramSplit: 1 / 3,
      setDiagramSplit: (diagramSplit) => set({ diagramSplit }),

      cursor: null,
      setCursor: (cursor) => set({ cursor }),

      activePanel: null,
      setActivePanel: (activePanel) => set({ activePanel }),

      diffLayout: 'split',
      setDiffLayout: (diffLayout) => set({ diffLayout }),
      diffCollapse: true,
      toggleDiffCollapse: () => set((s) => ({ diffCollapse: !s.diffCollapse })),
      diffWrap: true,
      toggleDiffWrap: () => set((s) => ({ diffWrap: !s.diffWrap })),
    }),
    {
      name: 'marknow.ui',
      partialize: (state) => ({
        mode: state.mode,
        rawPreviewVisible: state.rawPreviewVisible,
        outlineVisible: state.outlineVisible,
        rawSplit: state.rawSplit,
        dualSplit: state.dualSplit,
        wysiwygMeasure: state.wysiwygMeasure,
        diagramSplit: state.diagramSplit,
        diffLayout: state.diffLayout,
        diffCollapse: state.diffCollapse,
        diffWrap: state.diffWrap,
      }),
    },
  ),
);
