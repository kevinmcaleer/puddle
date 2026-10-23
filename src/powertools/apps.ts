import bundled from './apps.json';

/** One of Kev's Power Tools, as the landing page lists it. */
export interface PowerToolApp {
  id: string;
  name: string;
  url: string;
  description?: string;
  /** "soon" for an app that is not open yet: the switcher shows it but cannot go there. */
  status: 'live' | 'soon';
}

/** This app's id in the list, so the switcher can mark it as the one you are in. */
export const CURRENT_APP_ID = 'puddle';
/** The landing page, which lists every app. */
export const HOME_URL = 'https://kevspowertools.com/';
/**
 * The one app list the landing page and every app's switcher share. The landing page serves it with CORS and a
 * cross-origin resource policy, since Puddle is cross-origin isolated.
 */
export const APPS_URL = `${HOME_URL}apps.json`;

/** Only https addresses on kevspowertools.com, so a bad list can never send you somewhere else. */
const allowedUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'kevspowertools.com' || url.hostname.endsWith('.kevspowertools.com'));
  } catch {
    return false;
  }
};

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

/** The apps in a list, keeping only well-formed entries with an allowed address; undefined when none are left. */
export function parseApps(json: unknown): PowerToolApp[] | undefined {
  const entries = (json as { apps?: unknown } | null)?.apps;
  if (!Array.isArray(entries)) return undefined;
  const apps: PowerToolApp[] = [];
  for (const entry of entries as Record<string, unknown>[]) {
    const id = text(entry?.id);
    const name = text(entry?.name);
    const url = text(entry?.url);
    if (!id || !name || !url || !allowedUrl(url) || apps.some((a) => a.id === id)) continue;
    const description = text(entry.description);
    // Anything but "soon" counts as live, so a status added later never hides an app.
    const status = entry.status === 'soon' ? 'soon' : 'live';
    apps.push(description ? { id, name, url, description, status } : { id, name, url, status });
  }
  return apps.length ? apps : undefined;
}

/** The copy built into Puddle, used until the shared list arrives, or when it cannot be read. */
export const BUNDLED_APPS: PowerToolApp[] = parseApps(bundled)!;

/** The shared app list, or the built-in copy when the landing page cannot be reached or answers with nonsense. */
export async function loadApps(fetcher: typeof fetch = fetch, timeoutMs = 5000): Promise<PowerToolApp[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(APPS_URL, { signal: controller.signal, credentials: 'omit' });
    if (!response.ok) return BUNDLED_APPS;
    return parseApps(await response.json()) ?? BUNDLED_APPS;
  } catch {
    return BUNDLED_APPS;
  } finally {
    clearTimeout(timer);
  }
}
