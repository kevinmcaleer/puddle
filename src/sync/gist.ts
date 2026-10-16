import { SyncAuthError, SyncConflictError, SyncError, SyncMissingError, SyncOfflineError, type CredentialStore, type PulledFile, type RemoteFile, type SyncProvider } from './types';

export const GITHUB_API = 'https://api.github.com';

/** Gists holding a file with this ending are Puddle projects. */
const PROJECT_FILE = /\.puddle\.json$/i;
/** The Gist's description: what github.com shows, and where the project's name comes back from. */
const DESCRIPTION = 'Puddle project: ';

interface GistFile {
  filename?: string;
  content?: string;
  truncated?: boolean;
  raw_url?: string;
}

interface Gist {
  id: string;
  description: string | null;
  updated_at: string;
  files: Record<string, GistFile | null>;
  history?: { version: string }[];
}

const projectFileOf = (gist: Gist): [string, GistFile] | undefined => {
  const entry = Object.entries(gist.files).find(([name, f]) => f && PROJECT_FILE.test(name));
  return entry && entry[1] ? [entry[0], entry[1]] : undefined;
};

const titleOf = (gist: Gist, fileName: string) =>
  gist.description?.startsWith(DESCRIPTION) ? gist.description.slice(DESCRIPTION.length) : fileName.replace(PROJECT_FILE, '');

function remoteOf(gist: Gist): RemoteFile {
  const [fileName] = projectFileOf(gist) ?? [''];
  // The list leaves out history; a pull or head reads the revision from the full Gist.
  return { id: gist.id, title: titleOf(gist, fileName), fileName, updatedAt: gist.updated_at, revision: gist.history?.[0]?.version ?? '' };
}

/**
 * GitHub Gist as a sync provider: one secret Gist per project, holding its `.puddle.json`. Signs in with a
 * fine-grained personal access token limited to Gists (the OAuth device flow needs a server for CORS).
 *
 * The REST API has no conditional write for Gists, so a push reads the Gist's latest revision first and writes only
 * if it is still the one this browser last saw. A write landing in the moment between the two isn't caught.
 */
export function createGistProvider({ credentials, fetch: doFetch = (...a) => globalThis.fetch(...a) }: { credentials: CredentialStore; fetch?: typeof fetch }): SyncProvider {
  async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
    const secret = token ?? (await credentials.get('gist'))?.secret;
    if (!secret) throw new SyncAuthError('Connect to GitHub first.');
    let res: Response;
    try {
      res = await doFetch(`${GITHUB_API}${path}`, {
        ...init,
        // GitHub lets browsers keep its answers for a minute; a stale revision would hide a conflict.
        cache: 'no-store',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${secret}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
      });
    } catch {
      throw new SyncOfflineError();
    }
    if (res.status === 401) throw new SyncAuthError('GitHub didn’t accept the token. It may have expired or been revoked: connect again with a new one.');
    if (res.status === 404) throw new SyncMissingError();
    if (res.status === 403 || res.status === 429) {
      const limited = res.headers.get('x-ratelimit-remaining') === '0' || res.status === 429;
      throw new SyncError(limited ? 'GitHub’s rate limit was reached. Puddle will try again later.' : 'GitHub refused the request. Check the token can read and write Gists.');
    }
    if (!res.ok) throw new SyncError(`GitHub answered ${res.status}. Puddle will try again later.`);
    return (await res.json()) as T;
  }

  const getGist = (id: string) => request<Gist>(`/gists/${encodeURIComponent(id)}`);

  async function create(file: { title: string; fileName: string; text: string }): Promise<RemoteFile> {
    const gist = await request<Gist>('/gists', {
      method: 'POST',
      body: JSON.stringify({ description: DESCRIPTION + file.title, public: false, files: { [file.fileName]: { content: file.text } } }),
    });
    return remoteOf(gist);
  }

  return {
    id: 'gist',
    label: 'GitHub Gist',

    async connect(token) {
      const secret = token.trim();
      if (!secret) throw new SyncAuthError('Paste a personal access token first.');
      const user = await request<{ login: string }>('/user', {}, secret);
      await credentials.set('gist', secret, user.login);
      return user.login;
    },

    disconnect: () => credentials.delete('gist'),

    account: async () => (await credentials.get('gist'))?.account ?? null,

    async list() {
      const found: RemoteFile[] = [];
      for (let page = 1; page <= 10; page++) {
        const gists = await request<Gist[]>(`/gists?per_page=100&page=${page}`);
        for (const g of gists) if (projectFileOf(g)) found.push(remoteOf(g));
        if (gists.length < 100) break;
      }
      return found.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
    },

    head: async (id) => remoteOf(await getGist(id)),

    async pull(id): Promise<PulledFile> {
      const gist = await getGist(id);
      const found = projectFileOf(gist);
      if (!found) throw new SyncError('This Gist doesn’t hold a Puddle project.');
      const [, file] = found;
      let text = file.content ?? '';
      // Gist answers carry up to 1 MB of each file; a longer one is read from its raw address.
      if (file.truncated && file.raw_url) {
        try {
          const raw = await doFetch(file.raw_url, { cache: 'no-store' });
          if (!raw.ok) throw new Error();
          text = await raw.text();
        } catch {
          throw new SyncOfflineError();
        }
      }
      return { ...remoteOf(gist), text };
    },

    async push(file, base) {
      if (!base) return create(file);
      let gist: Gist;
      try {
        gist = await getGist(base.id);
      } catch (e) {
        if (e instanceof SyncMissingError) return create(file);
        throw e;
      }
      const remote = remoteOf(gist);
      if (remote.revision !== base.revision) throw new SyncConflictError(remote);
      // Rename the project file along with the project, so a Gist keeps one file.
      const files = { [remote.fileName || file.fileName]: { filename: file.fileName, content: file.text } };
      const updated = await request<Gist>(`/gists/${encodeURIComponent(base.id)}`, { method: 'PATCH', body: JSON.stringify({ description: DESCRIPTION + file.title, files }) });
      return remoteOf(updated);
    },
  };
}
