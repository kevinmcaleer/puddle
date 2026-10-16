import { describe, expect, it } from 'vitest';
import { addSource, createProject, type Project, type Source } from '../model';
import { writeProjectFile } from '../persistence/migrate';
import { readSynced, syncHash, syncText } from './file';

const pasted: Source = { id: 's_paste', name: 'Pasted data', kind: 'clipboard', clipboard: { text: 'sku\tqty\nSECRET-ROW\t3\n' }, format: 'tsv', parseOptions: {}, detectedSchema: [{ name: 'sku', type: 'VARCHAR' }] };
const url: Source = { id: 's_url', name: 'orders.csv', kind: 'url', url: { href: 'https://example.com/orders.csv', headers: { Authorization: 'Bearer SECRET-HEADER-VALUE', 'X-Api-Key': 'key-123' } }, format: 'csv', parseOptions: {}, detectedSchema: [] };

const withSources = (): Project => addSource(addSource(createProject('Synced'), pasted, { x: 0, y: 0 }), url, { x: 0, y: 200 });

describe('the synced file', () => {
  it('is the project file, less pasted rows', () => {
    const project = withSources();
    const text = syncText(project);
    expect(text).not.toContain('SECRET-ROW');
    const synced = JSON.parse(text) as Project;
    expect(synced.sources.find((s) => s.id === 's_paste')).not.toHaveProperty('clipboard');
    expect(synced.sources.find((s) => s.id === 's_paste')!.detectedSchema).toEqual(pasted.detectedSchema);
    // Everything else is exactly the export.
    const { sources: _a, ...rest } = JSON.parse(writeProjectFile(project)) as Project;
    const { sources: _b, ...syncedRest } = synced;
    expect(syncedRest).toEqual(rest);
    expect(synced.sources.find((s) => s.id === 's_url')).toEqual({ ...url, url: { ...url.url, headers: { Authorization: '', 'X-Api-Key': '' } } });
  });

  it('keeps request header names but never their values', () => {
    const text = syncText(withSources());
    expect(text).not.toContain('SECRET-HEADER-VALUE');
    expect(text).not.toContain('key-123');
    expect(text).toContain('"Authorization": ""');
  });

  it('leaves the project itself alone', () => {
    const project = withSources();
    syncText(project);
    expect(project.sources[0]!.clipboard?.text).toContain('SECRET-ROW');
  });

  it('reads back with the pasted rows this browser has', () => {
    const project = withSources();
    const back = readSynced(syncText(project), project);
    expect(back).toEqual(project);
    // Another browser has no rows or header values to give it.
    const elsewhere = readSynced(syncText(project));
    expect(elsewhere.sources[0]!.clipboard).toBeUndefined();
    expect(elsewhere.sources[1]!.url!.headers).toEqual({ Authorization: '', 'X-Api-Key': '' });
  });

  it('hashes the same whether or not the pasted rows and header values are here', () => {
    const project = withSources();
    expect(syncHash(readSynced(syncText(project)))).toBe(syncHash(project));
    expect(syncHash({ ...project, name: 'Renamed' })).not.toBe(syncHash(project));
  });

  it('doesn’t count moving around the canvas as a change to sync', () => {
    const project = withSources();
    expect(syncHash({ ...project, view: { ...project.view, canvasViewport: { x: 40, y: 10, zoom: 2 }, viewedNodeId: undefined } })).toBe(syncHash(project));
  });
});
