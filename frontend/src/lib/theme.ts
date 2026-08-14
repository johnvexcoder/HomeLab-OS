import { useTheme, ACCENT_HEX } from '@/store/theme';
import type { ThemeAccent } from '@/store/theme';

/** Resolved hex for the active accent, re-evaluated on theme changes. */
export function useAccentHex(): string {
  const accent = useTheme((s) => s.accent);
  return ACCENT_HEX[accent];
}

export { ACCENT_HEX, type ThemeAccent };
