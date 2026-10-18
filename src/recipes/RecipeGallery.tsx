import { useEffect } from 'react';
import { Banner, Button, Section } from '../ui';
import { refreshTemplates, useTemplates } from '../templates/library';
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

/** The templates saved in this browser: steps from a chain of nodes, inserted into any project from the Add menu. */
function SavedTemplates() {
  const templates = useTemplates((s) => s.templates);
  useEffect(() => void refreshTemplates().catch(() => undefined), []);
  return (
    <div className="flex flex-col gap-2" data-testid="home-templates">
      <h3 className="text-body-strong">Templates</h3>
      <p className="text-label text-ink-muted">Steps saved from a Transform node or a group of them. In a project, insert one from Add, From template, and it comes in as a chain of nodes after the selected one.</p>
      {templates.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Saved templates">
          {templates.map((t) => (
            <li key={t.id} className="rounded-md border border-line bg-surface-raised px-3 py-1 text-label" aria-label={t.name} title={t.description || undefined}>
              {t.name} · {t.steps.length} {t.steps.length === 1 ? 'step' : 'steps'}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The library on the home screen: the templates saved in this browser, and the built-in recipes, which are templates
 * of a whole flow, each with what it does and the columns it expects and a button to use it.
 */
export function RecipeGallery() {
  const state = useGallery((s) => s.state);
  const entries = useGallery((s) => s.entries);
  const notice = useRecipeNotice((s) => s.text);
  useEffect(() => void loadGallery(), []);
  return (
    <div className="rounded-md border border-line bg-surface-panel" data-testid="recipe-gallery">
      <Section title="Library">
        <div className="flex flex-col gap-3">
          <p className="text-label text-ink-muted">Two kinds of saved work, neither holding any data: a template is a run of steps, and a recipe is a template of a whole flow, sources and outputs included.</p>
          <SavedTemplates />
          <h3 className="text-body-strong">Recipes</h3>
          <p className="text-label text-ink-muted">Ready-made flows. Use one, then attach a file with the columns it expects. Export your own from the project menu.</p>
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
