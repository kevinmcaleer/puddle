import type { BrowserContext, Route } from '@playwright/test';

/** The OAuth client ID the e2e build is made with (playwright.config.ts), so the Google Drive option shows. */
export const E2E_GOOGLE_CLIENT_ID = 'puddle-e2e-test-only.apps.googleusercontent.com';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER = 'application/vnd.google-apps.folder';

interface MockFile {
  id: string;
  name: string;
  mimeType: string;
  description?: string;
  parents: string[];
  appProperties?: Record<string, string>;
  content: string;
  version: number;
  modifiedTime: string;
  trashed: boolean;
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'Authorization, Content-Type',
  'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
  'cross-origin-resource-policy': 'cross-origin',
};

/** The metadata and content parts of a Drive multipart upload. */
function multipart(contentType: string, body: string) {
  const boundary = /boundary=(.+)$/.exec(contentType)![1]!;
  const [meta, content] = body
    .split(`--${boundary}`)
    .slice(1, 3)
    .map((p) => p.split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, ''));
  return { meta: JSON.parse(meta!) as Partial<MockFile>, content: content! };
}

/**
 * Stand-ins for Google's sign-in page and the Drive API, shared by every browser context routed to them, so two
 * contexts act as two browsers on one Google account. Only the calls Puddle makes are answered.
 */
export function mockGoogleDrive() {
  const files = new Map<string, MockFile>();
  const tokens = new Set<string>();
  /** Every visit to the sign-in page, as its address. */
  const signIns: URL[] = [];
  const requests: { method: string; url: string; auth: string | undefined }[] = [];
  const revoked: string[] = [];
  let issued = 0;
  let deny = false;
  let clock = Date.UTC(2026, 9, 16, 9, 0, 0);
  const tick = () => new Date((clock += 60_000)).toISOString();

  const meta = ({ content: _, ...f }: MockFile) => ({ ...f, version: String(f.version) });

  /** Google's sign-in page: straight back to the app with a token (or a refusal) in the fragment. */
  async function signIn(route: Route) {
    const url = new URL(route.request().url());
    signIns.push(url);
    const back = new URLSearchParams({ state: url.searchParams.get('state') ?? '' });
    if (deny) {
      deny = false;
      back.set('error', 'access_denied');
    } else {
      const token = `drive-token-${++issued}`;
      tokens.add(token);
      back.set('access_token', token);
      back.set('token_type', 'Bearer');
      back.set('expires_in', '3599');
      back.set('scope', url.searchParams.get('scope') ?? '');
    }
    const to = `${url.searchParams.get('redirect_uri')}#${back}`;
    return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><title>Google</title><script>location.replace(${JSON.stringify(to)})</script>` });
  }

  async function api(route: Route) {
    const req = route.request();
    const url = new URL(req.url());
    const json = (status: number, body: unknown) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const headers = await req.allHeaders();
    requests.push({ method: req.method(), url: url.href, auth: headers.authorization });
    if (url.host === 'oauth2.googleapis.com') {
      revoked.push(url.searchParams.get('token') ?? '');
      return json(200, {});
    }
    if (!tokens.has((headers.authorization ?? '').replace(/^Bearer /, ''))) return json(401, { error: { code: 401, message: 'Invalid Credentials' } });
    const path = url.pathname;
    if (path === '/drive/v3/about') return json(200, { user: { emailAddress: 'kev@example.com', displayName: 'Kev' } });
    if (path === '/drive/v3/files' && req.method() === 'GET') {
      const q = url.searchParams.get('q') ?? '';
      const live = [...files.values()].filter((f) => !f.trashed);
      const found = q.includes(FOLDER) ? live.filter((f) => f.mimeType === FOLDER && f.name === 'Puddle') : live.filter((f) => f.appProperties?.puddle === 'project');
      return json(200, { files: found.sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime)).map(meta) });
    }
    if (path === '/drive/v3/files' && req.method() === 'POST') {
      const body = req.postDataJSON() as { name: string; mimeType: string };
      const f: MockFile = { id: `folder${files.size + 1}`, name: body.name, mimeType: body.mimeType, parents: [], content: '', version: 1, modifiedTime: tick(), trashed: false };
      files.set(f.id, f);
      return json(200, meta(f));
    }
    if (path === '/upload/drive/v3/files' && req.method() === 'POST') {
      const { meta: m, content } = multipart(headers['content-type']!, req.postData()!);
      const f: MockFile = { id: `file${files.size + 1}`, name: m.name!, mimeType: m.mimeType!, description: m.description, parents: m.parents ?? [], appProperties: m.appProperties, content, version: 1, modifiedTime: tick(), trashed: false };
      files.set(f.id, f);
      return json(200, meta(f));
    }
    const id = /^\/(?:upload\/)?drive\/v3\/files\/([^/]+)$/.exec(path)?.[1];
    const f = id && files.get(id);
    if (!f) return json(404, { error: { code: 404, message: 'File not found' } });
    if (req.method() === 'GET') return url.searchParams.get('alt') === 'media' ? route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: f.content }) : json(200, meta(f));
    if (req.method() === 'PATCH') {
      const { meta: m, content } = multipart(headers['content-type']!, req.postData()!);
      Object.assign(f, { name: m.name ?? f.name, description: m.description ?? f.description, content, version: f.version + 1, modifiedTime: tick() });
      return json(200, meta(f));
    }
    return json(405, { error: { message: 'Not supported here' } });
  }

  const projectFiles = () => [...files.values()].filter((f) => f.mimeType !== FOLDER);

  return {
    files,
    signIns,
    requests,
    revoked,
    async route(context: BrowserContext) {
      await context.route('https://accounts.google.com/o/oauth2/v2/auth**', signIn);
      await context.route('https://www.googleapis.com/**', api);
      await context.route('https://oauth2.googleapis.com/**', api);
    },
    /** The only project file. */
    file: () => {
      const all = projectFiles();
      if (all.length !== 1) throw new Error(`Expected one project file, found ${all.length}`);
      return all[0]!;
    },
    projectFiles,
    folder: () => [...files.values()].find((f) => f.mimeType === FOLDER),
    /** Every token Google gave out stops working, as after an hour. */
    expireTokens: () => tokens.clear(),
    /** The next sign-in is refused on Google's page. */
    denyNext: () => void (deny = true),
    /** Another browser saves a change to the project in Drive. */
    editElsewhere(change: (project: Record<string, unknown>) => Record<string, unknown>) {
      const f = projectFiles()[0]!;
      f.content = JSON.stringify(change(JSON.parse(f.content) as Record<string, unknown>), null, 2) + '\n';
      f.version += 1;
      f.modifiedTime = tick();
    },
    scope: SCOPE,
  };
}
