import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readGallery } from './gallery';

const dir = join(__dirname, '../../public/recipes');
const shipped = (file: string) => Promise.resolve(readFileSync(join(dir, file), 'utf8'));

describe('readGallery', () => {
  it('reads each shipped recipe’s name, description and the columns each source expects', async () => {
    const entries = await readGallery(shipped);
    expect(entries.map((e) => e.name)).toEqual(['Tidy a contact list', 'Standardise dates and currencies', 'Deduplicate customers', 'Monthly sales summary']);
    expect(entries[2]!.sources.map((s) => [s.name, s.columns.map((c) => c.name)])).toEqual([
      ['Orders', ['customer_id']],
      ['Customers', ['customer_id', 'name']],
    ]);
  });

  it('leaves out a recipe it can’t read, or a template, rather than failing the rest', async () => {
    const files: Record<string, string> = {
      'index.json': JSON.stringify(['good.json', 'newer.json', 'broken.json', 'template.json', 42]),
      'good.json': readFileSync(join(dir, 'tidy-contact-list.puddle-recipe.json'), 'utf8'),
      'newer.json': JSON.stringify({ puddleRecipe: 99, kind: 'pipeline' }),
      'broken.json': '{',
      'template.json': JSON.stringify({ puddleRecipe: 1, kind: 'template', formatVersion: 1, name: 'T', sources: [], nodes: [{ id: 'template', type: 'transform', name: 'T', steps: [{ id: 'a', type: 'trimWhitespace', label: 'x', params: { columns: ['a'] } }] }], edges: [] }),
    };
    const entries = await readGallery((f) => Promise.resolve(files[f]!));
    expect(entries.map((e) => e.file)).toEqual(['good.json']);
  });
});
