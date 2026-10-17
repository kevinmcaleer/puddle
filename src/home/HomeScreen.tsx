import { useRef } from 'react';
import { duplicateProject, importProject, newProject, openProject, useWorkspace } from '../persistence/workspace';
import { THEME_ICON, THEME_LABEL, useTheme } from '../app/theme';
import { Banner, Button, formatInstant, Menu, Toolbar, useDisplayFormat } from '../ui';
import { SamplePicker } from '../samples/SamplePicker';
import { openProjectDialog } from './dialogs';
import { PROVIDER_IDS, PROVIDERS } from '../sync';
import { openSyncDialog } from '../sync/dialogs';
import { openRecipeFile } from '../recipes/actions';
import { RecipeGallery } from '../recipes/RecipeGallery';


const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** The projects home screen: every project saved in this browser, with create, open, rename, duplicate, delete, the samples to try and the recipe gallery. */
export function HomeScreen() {
  const { projects, error } = useWorkspace();
  const theme = useTheme();
  const display = useDisplayFormat();
  const importInput = useRef<HTMLInputElement>(null);
  const recipeInput = useRef<HTMLInputElement>(null);

  return (
    <div className="grid h-full grid-rows-[auto_minmax(0,1fr)] bg-surface-canvas text-body text-ink" data-testid="home">
      <Toolbar>
        <Button variant="ghost" icon="export" onClick={() => importInput.current?.click()}>Import project</Button>
        <Button variant="ghost" icon="template" onClick={() => recipeInput.current?.click()}>Open recipe</Button>
        {PROVIDER_IDS.map((id) => (
          <Button key={id} variant="ghost" icon="refresh" onClick={() => openSyncDialog({ kind: 'open', provider: id })}>
            Open from {PROVIDERS[id]!.label}
          </Button>
        ))}
        <Button variant="primary" icon="plus" onClick={() => void newProject()}>New project</Button>
        <Button
          variant="ghost"
          icon={THEME_ICON[theme.preference]}
          iconOnly
          aria-label={THEME_LABEL[theme.preference]}
          title={THEME_LABEL[theme.preference]}
          onClick={theme.cycle}
        />
      </Toolbar>
      <input
        ref={importInput}
        type="file"
        accept=".json,application/json"
        hidden
        data-testid="import-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void importProject(file);
        }}
      />
      <input
        ref={recipeInput}
        type="file"
        accept=".json,application/json"
        hidden
        data-testid="recipe-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void openRecipeFile(file);
        }}
      />
      <main className="overflow-auto">
        <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-4 py-8">
          <div>
            <h1 className="font-display text-title">Projects</h1>
            <p className="text-ink-muted">Nothing leaves your browser. Projects save the steps, not the data.</p>
          </div>
          {error && <Banner tone="fail" title="That didn’t work">{error}</Banner>}
          {projects.length === 0 ? (
            <Banner tone="info" title="No projects yet">Start a new project, import a .puddle.json file, or try a sample below.</Banner>
          ) : (
            <ul className="flex flex-col divide-y divide-line rounded-md border border-line bg-surface-panel" aria-label="Projects">
              {projects.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-4 py-3" data-testid={`project-${p.name}`}>
                  <button type="button" className="min-w-0 flex-1 cursor-pointer bg-transparent text-left text-ink" onClick={() => void openProject(p.id)}>
                    <div className="truncate text-body-strong">{p.name}</div>
                    <div className="text-label text-ink-muted">
                      {plural(p.sources, 'source')} · {plural(p.nodes, 'node')} · Updated {formatInstant(p.updatedAt, false, display)}
                    </div>
                  </button>
                  <Menu
                    label={<span className="sr-only">More for {p.name}</span>}
                    button={{ variant: 'ghost', size: 'sm', icon: 'more', iconOnly: true, 'aria-label': `More for ${p.name}` }}
                    items={[
                      { label: 'Open', icon: 'eye', onSelect: () => void openProject(p.id) },
                      { label: 'Rename', icon: 'text', onSelect: () => openProjectDialog({ kind: 'rename', id: p.id, name: p.name }) },
                      { label: 'Duplicate', icon: 'append', onSelect: () => void duplicateProject(p.id) },
                      { label: 'Delete', icon: 'cross', onSelect: () => openProjectDialog({ kind: 'delete', id: p.id, name: p.name }) },
                    ]}
                  />
                </li>
              ))}
            </ul>
          )}
          <div className="rounded-md border border-line bg-surface-panel" data-testid="home-samples">
            <SamplePicker />
          </div>
          <RecipeGallery />
        </div>
      </main>
    </div>
  );
}
