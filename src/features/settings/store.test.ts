import { beforeEach, describe, expect, it } from 'vitest';

import { useSettingsStore } from './store';

describe('settings store (FR-13)', () => {
  beforeEach(() => {
    useSettingsStore.getState().resetToDefaults();
  });

  it('leaves diagram scrollbars off until asked for', () => {
    // The default is the whole point: a document stays one scrolling surface,
    // and a wide diagram shrinks rather than growing a scrollbar of its own.
    expect(useSettingsStore.getState().diagramScroll).toBe(false);
  });

  it('round-trips the preference and restores it on reset', () => {
    useSettingsStore.getState().setDiagramScroll(true);
    expect(useSettingsStore.getState().diagramScroll).toBe(true);

    useSettingsStore.getState().resetToDefaults();
    expect(useSettingsStore.getState().diagramScroll).toBe(false);
  });

  it('keeps the quick-action bubble hidden until asked for', () => {
    // Hidden is the default: the bubble covers the words it was summoned for,
    // and the toolbar already offers everything on it.
    expect(useSettingsStore.getState().bubbleMenu).toBe(false);

    useSettingsStore.getState().setBubbleMenu(true);
    expect(useSettingsStore.getState().bubbleMenu).toBe(true);

    useSettingsStore.getState().resetToDefaults();
    expect(useSettingsStore.getState().bubbleMenu).toBe(false);
  });

  it('persists under the shared settings key', () => {
    useSettingsStore.getState().setDiagramScroll(true);
    useSettingsStore.getState().setBubbleMenu(true);
    const stored = localStorage.getItem('marknow.settings');
    expect(stored).toContain('"diagramScroll":true');
    expect(stored).toContain('"bubbleMenu":true');
  });
});
