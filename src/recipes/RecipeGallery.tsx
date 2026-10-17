import { useEffect } from 'react';
import { Banner, Button, Section } from '../ui';
import { Columns } from '../templates/Mapping';
import { openGalleryRecipe, useRecipeNotice } from './actions';
import { loadGallery, useGallery, type GalleryEntry } from './gallery';

function Entry({ entry }: { entry: GalleryEntry }) {
  return (
    <li className="flex flex-col gap-3 rounded-md border border-line bg-surface-raised p-3" aria-label={entry.name} data-testid={`recipe-${entry.file}`}>
      <div className="flex flex-col gap-1">
        <h3 className="text-body-strong">{entry.name}</h3>
        <p className="text-label text-ink-muted">{entry.description}</p>
      </div>
      {entry.sources.map((s) => (
        <div key={s.id} className="flex flex-col gap-1">
          <span className="ui-eyebrow">{entry.sources.length > 1 ? `${s.name} expects` : 'Expects'}</span>
          <Columns columns={s.columns} />
        </div>
      ))}
      <div className="mt-auto">
        <Button size="sm" variant="secondary" icon="template" onClick={() => void openGalleryRecipe(entry.file)}>
          Use recipe
        </Button>
      </div>
    </li>
  );
}

/** The built-in recipes on the home screen: what each does and the columns it expects, with a button to use it. */
export function RecipeGallery() {
  const state = useGallery((s) => s.state);
  const entries = useGallery((s) => s.entries);
  const notice = useRecipeNotice((s) => s.text);
  useEffect(() => void loadGallery(), []);
  return (
    <div className="rounded-md border border-line bg-surface-panel" data-testid="recipe-gallery">
      <Section title="Recipe gallery">
        <div className="flex flex-col gap-3">
          <p className="text-label text-ink-muted">Ready-made pipelines with no data in them. Use one, then attach a file with the columns it expects.</p>
          {notice && <Banner tone="info">{notice}</Banner>}
          {state === 'failed' ? (
            <Banner tone="warn">The gallery couldn’t be loaded. Reload the page to try again.</Banner>
          ) : state !== 'ready' ? (
            <p className="text-label text-ink-muted">Loading recipes…</p>
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-label="Recipes">
              {entries.map((e) => (
                <Entry key={e.file} entry={e} />
              ))}
            </ul>
          )}
        </div>
      </Section>
    </div>
  );
}
