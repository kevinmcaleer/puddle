// The database files chosen for connections (SQLite, DuckDB, LibSQL files), by connection id, for this tab only.
// The project keeps the file's name in the connection's settings; the file itself, like a source's, is chosen
// again when the project is opened in another tab (plan D6).
import { create } from 'zustand';

const files = new Map<string, File>();

/** For React: the ids of the connections whose file is chosen in this tab. */
export const useConnectionFiles = create<{ ids: string[] }>(() => ({ ids: [] }));
const publish = () => useConnectionFiles.setState({ ids: [...files.keys()] });

export const connectionFile = (connectionId: string): File | undefined => files.get(connectionId);

export function rememberConnectionFile(connectionId: string, file: File) {
  files.set(connectionId, file);
  publish();
}

export function forgetConnectionFile(connectionId: string) {
  if (files.delete(connectionId)) publish();
}

/** Tests: start with no files. */
export function resetConnectionFiles() {
  files.clear();
  publish();
}
