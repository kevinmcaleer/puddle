// Schema versions: named points in the schema's history, kept in the project as `schema.versions` (newest first) for as
// long as the user wants. Saving, renaming and deleting are each one project change; restoring sets the DBML, so Undo
// takes it back like any edit.
import { newId, setSchemaDbml, type Project, type SchemaVersion } from '../model';

const withVersions = (p: Project, versions: SchemaVersion[]): Project => ({ ...p, schema: { ...p.schema, versions } });

/** A label for a new version that no other has: "Version 1", "Version 2", … counting from the oldest. */
export function nextVersionLabel(versions: SchemaVersion[]): string {
  const taken = new Set(versions.map((v) => v.label.toLowerCase()));
  for (let i = versions.length + 1; ; i++) if (!taken.has(`version ${i}`)) return `Version ${i}`;
}

/** Save the DBML as it is now, labelled, at the given time; the new version's id comes back with the project. */
export function saveSchemaVersion(p: Project, label: string, at: Date): { project: Project; id: string } {
  const id = newId('ver');
  const version = { id, label: label.trim() || nextVersionLabel(p.schema.versions), at: at.toISOString(), dbml: p.schema.dbml };
  return { project: withVersions(p, [version, ...p.schema.versions]), id };
}

export function renameSchemaVersion(p: Project, id: string, label: string): Project {
  const name = label.trim();
  const v = p.schema.versions.find((x) => x.id === id);
  if (!v || !name || v.label === name) return p;
  return withVersions(
    p,
    p.schema.versions.map((x) => (x.id === id ? { ...x, label: name } : x)),
  );
}

export function deleteSchemaVersion(p: Project, id: string): Project {
  const versions = p.schema.versions.filter((v) => v.id !== id);
  return versions.length === p.schema.versions.length ? p : withVersions(p, versions);
}

/** Make a version's DBML the current text; the versions themselves stay as they are. */
export function restoreSchemaVersion(p: Project, id: string): Project {
  const v = p.schema.versions.find((x) => x.id === id);
  return v ? setSchemaDbml(p, v.dbml) : p;
}

/** How much the saved versions add to the project file, in bytes of their text. */
export const versionsSize = (versions: SchemaVersion[]) => versions.reduce((n, v) => n + new TextEncoder().encode(v.dbml).length, 0);
