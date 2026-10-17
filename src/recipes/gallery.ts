// The built-in recipe gallery: static recipes in public/recipes, listed by public/recipes/index.json. They are served
// with the app and precached by the service worker, so the gallery works offline too.
import { create } from 'zustand';
import { galleryAddress } from './actions';
import { expectedBySource, readRecipe } from './recipe';

export interface GalleryEntry {
  /** The recipe's file under public/recipes. */
  file: string;
  name: string;
  description: string;
  /** Each source the recipe reads, by label, with the columns it expects. */
  sources: ReturnType<typeof expectedBySource>;
}

interface GalleryState {
  state: 'idle' | 'loading' | 'ready' | 'failed';
  entries: GalleryEntry[];
}

export const useGallery = create<GalleryState>(() => ({ state: 'idle', entries: [] }));

/** Read the gallery's recipes into entries. A recipe that can't be read is left out rather than failing the rest. */
export async function readGallery(fetchText: (file: string) => Promise<string>): Promise<GalleryEntry[]> {
  const files: unknown = JSON.parse(await fetchText('index.json'));
  if (!Array.isArray(files)) return [];
  const read = await Promise.all(
    files
      .filter((f): f is string => typeof f === 'string')
      .map(async (file) => {
        try {
          const r = readRecipe(await fetchText(file));
          return r.kind === 'pipeline' ? [{ file, name: r.name, description: r.description, sources: expectedBySource(r) }] : [];
        } catch {
          return [];
        }
      }),
  );
  return read.flat();
}

async function fetchText(file: string): Promise<string> {
  const res = await fetch(galleryAddress(file));
  if (!res.ok) throw new Error(`${file}: ${res.status}`);
  return res.text();
}

/** Load the gallery once per page, or again after it failed to load. */
export async function loadGallery() {
  const { state } = useGallery.getState();
  if (state === 'loading' || state === 'ready') return;
  useGallery.setState({ state: 'loading' });
  try {
    useGallery.setState({ state: 'ready', entries: await readGallery(fetchText) });
  } catch {
    // Tried again the next time the home screen shows.
    useGallery.setState({ state: 'failed' });
  }
}
