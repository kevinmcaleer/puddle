// What the recipe controls do: export the open project or a template as a recipe, open a recipe file or a gallery
// recipe as a new project, and add a template recipe to the library.
import { create } from 'zustand';
import { useSession } from '../app/session';
import { useProjectStore } from '../model';
import { openNewProject, useWorkspace } from '../persistence/workspace';
import { addTemplate } from '../templates/library';
import type { Template } from '../templates/template';
import { projectFromRecipe, readRecipe, recipeFileName, recipeFromProject, recipeFromTemplate, RecipeError, writeRecipe, type Recipe } from './recipe';

/** The recipe dialog open in the editor: exporting the open project. */
export const useRecipeDialog = create<{ open: boolean }>(() => ({ open: false }));

export const openExportRecipe = (open = true) => useRecipeDialog.setState({ open });

/** A note for the home screen, such as a template recipe added to the library. Problems go to the workspace's error. */
export const useRecipeNotice = create<{ text: string | null }>(() => ({ text: null }));

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Say what went wrong where it will be seen: on the home screen, or as the editor's notice. */
function report(e: unknown) {
  useRecipeNotice.setState({ text: null });
  if (useWorkspace.getState().screen === 'home') useWorkspace.setState({ error: message(e) });
  else useSession.getState().notify({ tone: 'fail', text: message(e) });
}

function inform(text: string) {
  if (useWorkspace.getState().screen === 'home') {
    useWorkspace.setState({ error: null });
    useRecipeNotice.setState({ text });
  } else useSession.getState().notify({ tone: 'info', text });
}

function download(text: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Download the open project as a `.puddle-recipe.json`: its pipeline, never its data. */
export function exportRecipe(about: { name: string; description: string }) {
  const recipe = recipeFromProject(useProjectStore.getState().history.present, about);
  download(writeRecipe(recipe), recipeFileName(recipe.name));
}

/** Download a template as a single-node recipe. */
export function exportTemplateRecipe(template: Template) {
  download(writeRecipe(recipeFromTemplate(template)), recipeFileName(template.name));
}

const templateAdded = (t: Template) => `Added “${t.name}” to your templates. Insert it from Add node, From template, in any project.`;

/** Open a recipe read and checked: a pipeline as a new project, a template into the library. */
async function open(recipe: Recipe) {
  if (recipe.kind === 'template') {
    await addTemplate(recipe.template);
    return inform(templateAdded(recipe.template));
  }
  useRecipeNotice.setState({ text: null });
  await openNewProject(projectFromRecipe(recipe));
}

/** Open a `.puddle-recipe.json` file chosen by the user. */
export async function openRecipeFile(file: File) {
  try {
    await open(readRecipe(await file.text()));
  } catch (e) {
    report(e);
  }
}

/** Where the built-in gallery is served: public/recipes, next to the app, and precached for offline use. */
export const galleryAddress = (file: string, base = document.baseURI) => new URL(`recipes/${encodeURIComponent(file)}`, base);

/** Open a recipe from the built-in gallery as a new project. */
export async function openGalleryRecipe(file: string) {
  try {
    const res = await fetch(galleryAddress(file));
    if (!res.ok) throw new RecipeError('Puddle couldn’t load that recipe. Reload the page and try again.');
    await open(readRecipe(await res.text()));
  } catch (e) {
    report(e);
  }
}

/** Import a template recipe into the library, from the templates dialog, saying how it went. A whole pipeline is refused with a pointer. */
export async function importTemplateFile(file: File): Promise<{ tone: 'info' | 'fail'; text: string; template?: Template }> {
  try {
    const recipe = readRecipe(await file.text());
    if (recipe.kind !== 'template') throw new RecipeError('This recipe is a whole pipeline, not a template. Open it with Open recipe on the projects screen.');
    await addTemplate(recipe.template);
    return { tone: 'info', text: `Added “${recipe.template.name}” to your templates.`, template: recipe.template };
  } catch (e) {
    return { tone: 'fail', text: message(e) };
  }
}
