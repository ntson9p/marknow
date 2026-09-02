import { beforeEach, describe, expect, it } from 'vitest';

import { initTheme, useThemeStore } from '@/features/settings/theme';

describe('theme controller', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    useThemeStore.setState({ theme: 'system' });
  });

  it('defaults to system when nothing is stored', () => {
    initTheme();
    expect(useThemeStore.getState().theme).toBe('system');
  });

  it('applies and persists dark theme', () => {
    useThemeStore.getState().setTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('marknow.theme')).toBe('dark');
  });

  it('applies and persists light theme', () => {
    useThemeStore.getState().setTheme('dark');
    useThemeStore.getState().setTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(localStorage.getItem('marknow.theme')).toBe('light');
  });

  it('restores the stored theme on init', () => {
    localStorage.setItem('marknow.theme', 'dark');
    initTheme();
    expect(useThemeStore.getState().theme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
