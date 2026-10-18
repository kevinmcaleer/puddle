import { createProject, setSchemaDbml, type Project } from '../model';
import { deleteSchemaVersion, nextVersionLabel, renameSchemaVersion, restoreSchemaVersion, saveSchemaVersion, versionsSize } from './versions';

const AT = new Date('2026-10-18T12:00:00Z');
const withText = (dbml: string): Project => setSchemaDbml(createProject('Versions'), dbml);

describe('schema versions', () => {
  it('saves the DBML newest first, labelled or numbered', () => {
    let p = withText('Table a {\n  id int\n}');
    const first = saveSchemaVersion(p, '', AT);
    p = setSchemaDbml(first.project, 'Table b {\n  id int\n}');
    const second = saveSchemaVersion(p, '  Before orders  ', new Date('2026-10-18T13:00:00Z'));
    expect(second.project.schema.versions.map((v) => [v.label, v.at, v.dbml.slice(0, 7)])).toEqual([
      ['Before orders', '2026-10-18T13:00:00.000Z', 'Table b'],
      ['Version 1', '2026-10-18T12:00:00.000Z', 'Table a'],
    ]);
    expect(second.project.schema.versions[0]!.id).toBe(second.id);
  });

  it('numbers past labels already taken', () => {
    expect(nextVersionLabel([{ id: 'a', label: 'version 2', at: '', dbml: '' }])).toBe('Version 3');
  });

  it('renames, ignoring an empty name, and deletes', () => {
    const { project, id } = saveSchemaVersion(withText('Table a {\n  id int\n}'), 'One', AT);
    expect(renameSchemaVersion(project, id, '  ')).toBe(project);
    const renamed = renameSchemaVersion(project, id, 'First');
    expect(renamed.schema.versions[0]!.label).toBe('First');
    expect(deleteSchemaVersion(renamed, id).schema.versions).toEqual([]);
    expect(deleteSchemaVersion(renamed, 'nope')).toBe(renamed);
  });

  it('restores a version as the current DBML and keeps every version', () => {
    const { project, id } = saveSchemaVersion(withText('Table a {\n  id int\n}'), 'One', AT);
    const changed = setSchemaDbml(project, 'Table z {\n  id int\n}');
    const restored = restoreSchemaVersion(changed, id);
    expect(restored.schema.dbml).toBe('Table a {\n  id int\n}');
    expect(restored.schema.versions).toHaveLength(1);
  });

  it('counts the bytes the versions add', () => {
    const { project } = saveSchemaVersion(withText('é'), 'One', AT);
    expect(versionsSize(project.schema.versions)).toBe(2);
  });
});
