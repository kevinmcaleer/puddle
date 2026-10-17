// The display locale: how numbers and dates look on this device. It never changes data, steps or exports.
import { create } from 'zustand';

export type DateDisplay = 'locale' | 'iso';

/** What the formatting functions in format.ts need: a resolved locale and how dates are shown. */
export interface DisplayFormat {
  locale: string;
  dates: DateDisplay;
}

/** 'browser' follows the browser's language; anything else is a locale picked here. */
export interface DisplayPreference {
  locale: 'browser' | string;
  dates: DateDisplay;
}

/** Locales offered for display. Any locale the browser formats would do; these cover the common number and date styles. */
export const DISPLAY_LOCALES = [
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-IN', label: 'English (India)' },
  { value: 'de-DE', label: 'German' },
  { value: 'de-CH', label: 'German (Switzerland)' },
  { value: 'fr-FR', label: 'French' },
  { value: 'es-ES', label: 'Spanish' },
  { value: 'it-IT', label: 'Italian' },
  { value: 'nl-NL', label: 'Dutch' },
  { value: 'pt-BR', label: 'Portuguese (Brazil)' },
  { value: 'sv-SE', label: 'Swedish' },
  { value: 'pl-PL', label: 'Polish' },
  { value: 'ja-JP', label: 'Japanese' },
];

const KEY = 'puddle.display';
const FALLBACK = 'en-GB';

/** A locale the browser can format with, or undefined. */
function supported(locale: unknown): string | undefined {
  if (typeof locale !== 'string' || !locale) return undefined;
  try {
    return Intl.getCanonicalLocales(locale)[0];
  } catch {
    return undefined;
  }
}

/** The browser's language, as Playwright's `locale` option and the user's settings set it. */
export function browserLocale(): string {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  return supported(nav?.languages?.[0]) ?? supported(nav?.language) ?? FALLBACK;
}

export const resolveDisplay = (pref: DisplayPreference): DisplayFormat => ({ locale: pref.locale === 'browser' ? browserLocale() : (supported(pref.locale) ?? FALLBACK), dates: pref.dates });

function readPreference(): DisplayPreference {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<DisplayPreference> | null;
    return { locale: supported(v?.locale) ?? 'browser', dates: v?.dates === 'iso' ? 'iso' : 'locale' };
  } catch {
    return { locale: 'browser', dates: 'locale' };
  }
}

interface DisplayState {
  preference: DisplayPreference;
  /** Resolved from the preference; replaced only when it changes, so it is safe to select. */
  format: DisplayFormat;
  setPreference: (patch: Partial<DisplayPreference>) => void;
}

const initial = readPreference();

export const useDisplay = create<DisplayState>((set, get) => ({
  preference: initial,
  format: resolveDisplay(initial),
  setPreference: (patch) => {
    const preference = { ...get().preference, ...patch };
    try {
      if (preference.locale === 'browser' && preference.dates === 'locale') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, JSON.stringify(preference));
    } catch {
      // Storage is blocked (private window); the choice lasts for this tab only.
    }
    set({ preference, format: resolveDisplay(preference) });
  },
}));

/** The display format, re-rendering the component when it changes. */
export const useDisplayFormat = () => useDisplay((s) => s.format);

/** The display format now, for code outside React (and defaults of the formatting functions). */
export const displayFormat = () => useDisplay.getState().format;
