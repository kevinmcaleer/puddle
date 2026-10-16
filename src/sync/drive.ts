import { DRIVE_SCOPE } from './drive-auth';
import { SyncAuthError, SyncConflictError, SyncError, SyncMissingError, SyncOfflineError, type PulledFile, type PushFile, type RemoteFile, type SignInReturn, type SyncProvider } from './types';

export const DRIVE_API = 'https://www.googleapis.com/drive/v3';
export const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
export const GOOGLE_REVOKE = 'https://oauth2.googleapis.com/revoke';

/** The folder new project files go in. */
export const FOLDER = 'Puddle';
const FOLDER_TYPE = 'application/vnd.google-apps.folder';
/** Every project file carries this app property, so listing finds them wherever the user moves them. */
const MARK = { key: 'puddle', value: 'project' };
/** The file's description: what Drive shows, and where the project's name comes back from. */
const DESCRIPTION = 'Puddle project: ';
const PROJECT_FILE = /\.puddle\.json$/i;
const FIELDS = 'id,name,description,modifiedTime,version,trashed';

/** A Google access token, which lasts about an hour. Never a refresh token: there is none in the browser flow. */
export interface DriveToken {
  token: string;
  /** When to stop using it (ms since the epoch), a minute before Google would refuse it. */
  expiresAt: number;
  account: string;
}

/** Where the token lives while it lasts: this tab's session storage in the app, a variable in tests. */
export interface TokenStore {
  get(): DriveToken | undefined;
  set(token: DriveToken): void;
  delete(): void;
}

interface DriveFile {
  id: string;
  name: string;
  description?: string;
  modifiedTime: string;
  version?: string | number;
  trashed?: boolean;
}

const titleOf = (f: DriveFile) => (f.description?.startsWith(DESCRIPTION) ? f.description.slice(DESCRIPTION.length) : f.name.replace(PROJECT_FILE, ''));

const remoteOf = (f: DriveFile): RemoteFile => ({ id: f.id, title: titleOf(f), fileName: f.name, updatedAt: f.modifiedTime, revision: String(f.version ?? '') });

/** A quoted value in a Drive search query. */
const q = (value: string) => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** A metadata part and a content part, as Drive's multipart upload takes them. */
function multipart(meta: object, text: string) {
  const boundary = `puddle-${crypto.randomUUID()}`;
  const body = [`--${boundary}`, 'Content-Type: application/json; charset=UTF-8', '', JSON.stringify(meta), `--${boundary}`, 'Content-Type: application/json', '', text, `--${boundary}--`, ''].join('\r\n');
  return { body, type: `multipart/related; boundary=${boundary}` };
}

/**
 * Google Drive as a sync provider: one `.puddle.json` file per project, in a "Puddle" folder. Puddle asks only for
 * the `drive.file` scope, so it sees the files it made and nothing else in the user's Drive.
 *
 * Signing in is a full-page visit to Google (`signIn`, see drive-auth.ts), which comes back with a short-lived access
 * token. The token stays in this tab only and is never refreshed: when it runs out, the user signs in again.
 *
 * Drive's v3 API has no conditional write, so, as with Gist, a push reads the file's version first and writes only if
 * it is still the one this browser last saw. A write landing in the moment between the two isn't caught.
 */
export function createDriveProvider({
  tokens,
  signIn,
  fetch: doFetch = (...a) => globalThis.fetch(...a),
  now = Date.now,
}: {
  tokens: TokenStore;
  signIn: (after: SignInReturn) => Promise<void>;
  fetch?: typeof fetch;
  now?: () => number;
}): SyncProvider {
  function current(): DriveToken | undefined {
    const t = tokens.get();
    if (t && t.expiresAt <= now()) {
      tokens.delete();
      return undefined;
    }
    return t;
  }

  async function request(url: string, init: RequestInit = {}, token?: string): Promise<Response> {
    const secret = token ?? current()?.token;
    if (!secret) throw new SyncAuthError('Sign in to Google Drive again to carry on syncing. Puddle keeps the sign-in for an hour at most, and only in this tab.');
    let res: Response;
    try {
      res = await doFetch(url, { ...init, cache: 'no-store', headers: { Authorization: `Bearer ${secret}`, ...(init.headers as Record<string, string> | undefined) } });
    } catch {
      throw new SyncOfflineError();
    }
    if (res.status === 401) {
      if (!token) tokens.delete();
      throw new SyncAuthError('Your Google sign-in has run out. Sign in to Google Drive again to carry on syncing.');
    }
    if (res.status === 404) throw new SyncMissingError();
    if (res.status === 403 || res.status === 429) {
      const reason = res.status === 429 ? 'rateLimitExceeded' : await res.json().then((b: { error?: { errors?: { reason?: string }[] } }) => b.error?.errors?.[0]?.reason ?? '', () => '');
      throw new SyncError(/rateLimit/i.test(reason) ? 'Google Drive’s rate limit was reached. Puddle will try again later.' : 'Google Drive refused the request. Sign in again and allow Puddle to see the files it makes.');
    }
    if (!res.ok) throw new SyncError(`Google Drive answered ${res.status}. Puddle will try again later.`);
    return res;
  }

  const json = async <T>(url: string, init?: RequestInit, token?: string) => (await (await request(url, init, token)).json()) as T;

  async function metadata(id: string): Promise<DriveFile> {
    const f = await json<DriveFile>(`${DRIVE_API}/files/${encodeURIComponent(id)}?fields=${FIELDS}`);
    // A file in the bin is gone as far as syncing goes: the next push makes a new one.
    if (f.trashed) throw new SyncMissingError();
    return f;
  }

  /** The Puddle folder Puddle made, made now if there is none (or only one in the bin). */
  async function folder(): Promise<string> {
    const query = `mimeType=${q(FOLDER_TYPE)} and name=${q(FOLDER)} and trashed=false`;
    const found = await json<{ files: { id: string }[] }>(`${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=files(id)&pageSize=1`);
    if (found.files[0]) return found.files[0].id;
    const made = await json<{ id: string }>(`${DRIVE_API}/files?fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: FOLDER, mimeType: FOLDER_TYPE }) });
    return made.id;
  }

  async function upload(url: string, method: string, meta: object, text: string) {
    const { body, type } = multipart(meta, text);
    return remoteOf(await json<DriveFile>(url, { method, headers: { 'Content-Type': type }, body }));
  }

  const create = async (file: PushFile) =>
    upload(
      `${DRIVE_UPLOAD}/files?uploadType=multipart&fields=${FIELDS}`,
      'POST',
      { name: file.fileName, mimeType: 'application/json', parents: [await folder()], description: DESCRIPTION + file.title, appProperties: { [MARK.key]: MARK.value } },
      file.text,
    );

  return {
    id: 'drive',
    label: 'Google Drive',

    signIn: (after) => signIn(after),

    async connect(answer) {
      const params = new URLSearchParams(answer);
      const token = params.get('access_token');
      if (!token) throw new SyncAuthError('Google didn’t send a sign-in back. Try again.');
      // Google's consent screen lets people untick a permission; without this one there is nothing to sync with.
      if (!(params.get('scope') ?? '').split(' ').includes(DRIVE_SCOPE)) throw new SyncAuthError('Puddle needs permission to see the files it makes in your Google Drive. Sign in again and allow it.');
      const about = await json<{ user?: { emailAddress?: string; displayName?: string } }>(`${DRIVE_API}/about?fields=user(emailAddress,displayName)`, {}, token);
      const account = about.user?.emailAddress || about.user?.displayName || 'your Google account';
      const lifetime = Number(params.get('expires_in')) || 3600;
      tokens.set({ token, expiresAt: now() + Math.max(lifetime - 60, 0) * 1000, account });
      return account;
    },

    async disconnect() {
      const t = tokens.get();
      tokens.delete();
      // Ask Google to forget the token too; it runs out within the hour anyway.
      if (t) await doFetch(`${GOOGLE_REVOKE}?token=${encodeURIComponent(t.token)}`, { method: 'POST' }).catch(() => undefined);
    },

    account: async () => current()?.account ?? null,

    async list() {
      const query = `appProperties has { key=${q(MARK.key)} and value=${q(MARK.value)} } and trashed=false`;
      const found: RemoteFile[] = [];
      let page = '';
      for (let i = 0; i < 10; i++) {
        const res = await json<{ files: DriveFile[]; nextPageToken?: string }>(
          `${DRIVE_API}/files?q=${encodeURIComponent(query)}&orderBy=modifiedTime%20desc&pageSize=100&fields=nextPageToken,files(${FIELDS})${page && `&pageToken=${encodeURIComponent(page)}`}`,
        );
        found.push(...res.files.map(remoteOf));
        if (!res.nextPageToken) break;
        page = res.nextPageToken;
      }
      return found.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
    },

    head: async (id) => remoteOf(await metadata(id)),

    async pull(id): Promise<PulledFile> {
      // The version first, then the text: a write in between makes the text newer than the version, which at worst
      // reads as a conflict later. The other order could pair an old text with a new version and lose that write.
      const meta = await metadata(id);
      const text = await (await request(`${DRIVE_API}/files/${encodeURIComponent(id)}?alt=media`)).text();
      return { ...remoteOf(meta), text };
    },

    async push(file, base) {
      if (!base) return create(file);
      let meta: DriveFile;
      try {
        meta = await metadata(base.id);
      } catch (e) {
        if (e instanceof SyncMissingError) return create(file);
        throw e;
      }
      const remote = remoteOf(meta);
      if (remote.revision !== base.revision) throw new SyncConflictError(remote);
      return upload(`${DRIVE_UPLOAD}/files/${encodeURIComponent(base.id)}?uploadType=multipart&fields=${FIELDS}`, 'PATCH', { name: file.fileName, description: DESCRIPTION + file.title }, file.text);
    },
  };
}
