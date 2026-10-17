import type { Source } from '../model';
import { detachedMessage } from './attach';

const source = (patch: Partial<Source>): Source => ({ id: 's', name: 'Contact list', kind: 'file', format: 'csv', parseOptions: {}, detectedSchema: [], ...patch });

describe('detachedMessage', () => {
  it('asks for the file a project was built on again', () => {
    expect(detachedMessage(source({ file: { originalName: 'contacts.csv', size: 1, lastModified: 0, headHash: 'h' } }))).toBe('Projects save the steps, not the data, so choose contacts.csv again to read it.');
  });

  it('asks a recipe’s source, which has never had a file, for one', () => {
    expect(detachedMessage(source({}))).toBe('Recipes hold the steps, not the data, so choose a file for Contact list to read it.');
  });
});
