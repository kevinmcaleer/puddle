// Principle 22: "Export" means data leaving Puddle. Saving or sharing the project, a recipe, a template or a report is
// named as a save or a share, so the word keeps its meaning in every menu and dialog.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const FILES = ['src/app/AppShell.tsx', 'src/home/HomeScreen.tsx', 'src/recipes/RecipeDialogs.tsx', 'src/report/ReportDialog.tsx', 'src/templates/TemplateDialogs.tsx'];

/** Labels, titles, confirm buttons and button text that start with Export. */
function exportLabels(source: string): string[] {
  const quoted = [...source.matchAll(/(?:label|title|confirm)[=:]\s*\{?\s*['"`](Export[^'"`]*)['"`]/g)].map((m) => m[1]!);
  const text = [...source.matchAll(/>\s*(Export[^<{]*?)\s*</g)].map((m) => m[1]!);
  return [...quoted, ...text];
}

describe('the word Export', () => {
  it('names only data leaving Puddle', () => {
    const labels = FILES.flatMap((f) => exportLabels(readFileSync(f, 'utf8')));
    expect(labels.filter((l) => l !== 'Export all')).toEqual([]);
  });

  it('is found by the check when used for a save', () => {
    expect(exportLabels(`{ label: 'Export project', icon: 'export' }`)).toEqual(['Export project']);
    expect(exportLabels(`<Button>\n  Export\n</Button>`)).toEqual(['Export']);
  });
});
