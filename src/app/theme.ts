import { create } from 'zustand';

export type ThemePreference = 'system' | 'light' | 'dark';

const KEY = 'puddle.theme';

function readPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

/** System follows the OS through prefers-color-scheme; a manual pick pins data-theme on <html>. */
export function applyTheme(pref: ThemePreference, root: HTMLElement = document.documentElement) {
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
}

interface ThemeState {
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
  cycle: () => void;
}

const ORDER: ThemePreference[] = ['system', 'light', 'dark'];

export const useTheme = create<ThemeState>((set, get) => ({
  preference: readPreference(),
  setPreference: (preference) => {
    try {
      if (preference === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, preference);
    } catch {
      // Storage is blocked (private window); the choice lasts for this tab only.
    }
    applyTheme(preference);
    set({ preference });
  },
  cycle: () => get().setPreference(ORDER[(ORDER.indexOf(get().preference) + 1) % ORDER.length]!),
}));

export const THEME_LABEL: Record<ThemePreference, string> = { system: 'Theme: match system', light: 'Theme: light', dark: 'Theme: dark' };
export const THEME_ICON = { system: 'monitor', light: 'sun', dark: 'moon' } as const;
