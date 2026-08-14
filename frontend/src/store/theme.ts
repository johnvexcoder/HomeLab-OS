import { create } from 'zustand';

export type ThemeAppearance = 'dark' | 'light';
export type ThemeAccent = 'green' | 'purple' | 'blue' | 'orange' | 'red' | 'pink';

export const ACCENTS: ThemeAccent[] = ['green', 'purple', 'blue', 'orange', 'red', 'pink'];

export const ACCENT_HEX: Record<ThemeAccent, string> = {
  green: '#34D399',
  purple: '#A78BFA',
  blue: '#3B82F6',
  orange: '#F97316',
  red: '#EF4444',
  pink: '#EC4899',
};

export const ACCENT_LABEL: Record<ThemeAccent, string> = {
  green: 'Green',
  purple: 'Purple',
  blue: 'Blue',
  orange: 'Orange',
  red: 'Red',
  pink: 'Pink',
};

const STORAGE_KEY = 'homelab-theme';

interface ThemeState {
  appearance: ThemeAppearance;
  accent: ThemeAccent;
  setAppearance: (appearance: ThemeAppearance) => void;
  setAccent: (accent: ThemeAccent) => void;
}

function loadInitial(): { appearance: ThemeAppearance; accent: ThemeAccent } {
  const fallback = { appearance: 'dark' as ThemeAppearance, accent: 'green' as ThemeAccent };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<{ appearance: ThemeAppearance; accent: ThemeAccent }>;
    return {
      appearance: parsed.appearance === 'light' ? 'light' : 'dark',
      accent: ACCENTS.includes(parsed.accent as ThemeAccent) ? (parsed.accent as ThemeAccent) : 'green',
    };
  } catch {
    return fallback;
  }
}

function applyTheme(appearance: ThemeAppearance, accent: ThemeAccent): void {
  const root = document.documentElement;
  root.dataset.theme = appearance;
  root.dataset.accent = accent;
}

export function initTheme(): void {
  const initial = loadInitial();
  applyTheme(initial.appearance, initial.accent);
}

export const useTheme = create<ThemeState>((set) => {
  const initial = loadInitial();
  applyTheme(initial.appearance, initial.accent);

  return {
    appearance: initial.appearance,
    accent: initial.accent,
    setAppearance: (appearance) => {
      set({ appearance });
      applyTheme(appearance, useTheme.getState().accent);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ appearance, accent: useTheme.getState().accent }));
    },
    setAccent: (accent) => {
      set({ accent });
      applyTheme(useTheme.getState().appearance, accent);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ appearance: useTheme.getState().appearance, accent }));
    },
  };
});
