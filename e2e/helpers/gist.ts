import type { BrowserContext, Route } from '@playwright/test';

export const TOKEN = 'github_pat_test_only_token';

interface MockGist {
  id: string;
  description: string;
  public: boolean;
  updated_at: string;
  files: Record<string, { filename: string; content: string }>;
  version: number;
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'Authorization, Content-Type, Accept, X-GitHub-Api-Version',
  'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
  'cross-origin-resource-policy': 'cross-origin',
};

/**
 * A stand-in for GitHub's Gist API, shared by every browser context routed to it, so two contexts act as two
 * browsers on one GitHub account. Only the calls Puddle makes are answered.
 */
export function mockGistApi() {
  const gists = new Map<string, MockGist>();
  const requests: { method: string; path: string; auth: string | undefined; body: string | null }[] = [];
  let clock = Date.UTC(2026, 9, 16, 9, 0, 0);
  const tick = () => new Date((clock += 60_000)).toISOString().replace('.000', '');

  const full = (g: MockGist) => ({
    id: g.id,
    description: g.description,
    public: g.public,
    updated_at: g.updated_at,
    files: Object.fromEntries(Object.values(g.files).map((f) => [f.filename, { filename: f.filename, content: f.content, truncated: false }])),
    history: [{ version: `v${g.version}` }],
  });

  async function handle(route: Route) {
    const req = route.request();
    const url = new URL(req.url());
    const json = (status: number, body: unknown) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const auth = (await req.allHeaders()).authorization;
    requests.push({ method: req.method(), path: url.pathname + url.search, auth, body: req.postData() });
    if (auth !== `Bearer ${TOKEN}`) return json(401, { message: 'Bad credentials' });
    const path = url.pathname;
    if (path === '/user') return json(200, { login: 'kev' });
    if (path === '/gists' && req.method() === 'GET') {
      const list = [...gists.values()].map((g) => {
        const { history: _, ...rest } = full(g);
        return { ...rest, files: Object.fromEntries(Object.keys(rest.files).map((n) => [n, { filename: n }])) };
      });
      return json(200, url.searchParams.get('page') === '1' ? list : []);
    }
    if (path === '/gists' && req.method() === 'POST') {
      const body = req.postDataJSON() as { description: string; public: boolean; files: Record<string, { content: string }> };
      const id = `gist${gists.size + 1}`;
      const files = Object.fromEntries(Object.entries(body.files).map(([n, f]) => [n, { filename: n, content: f.content }]));
      const g: MockGist = { id, description: body.description, public: body.public, updated_at: tick(), files, version: 1 };
      gists.set(id, g);
      return json(201, full(g));
    }
    const m = /^\/gists\/([^/]+)$/.exec(path);
    const g = m && gists.get(m[1]!);
    if (!g) return json(404, { message: 'Not Found' });
    if (req.method() === 'GET') return json(200, full(g));
    if (req.method() === 'PATCH') {
      const body = req.postDataJSON() as { description?: string; files: Record<string, { filename?: string; content: string }> };
      for (const [name, f] of Object.entries(body.files)) {
        delete g.files[name];
        const filename = f.filename ?? name;
        g.files[filename] = { filename, content: f.content };
      }
      if (body.description) g.description = body.description;
      g.version += 1;
      g.updated_at = tick();
      return json(200, full(g));
    }
    return json(405, { message: 'Not supported here' });
  }

  return {
    gists,
    requests,
    route: (context: BrowserContext) => context.route('https://api.github.com/**', handle),
    /** The one project file a Gist holds. */
    file: (id = 'gist1') => Object.values(gists.get(id)!.files)[0]!,
    /** Another browser saves a change to the project in the Gist. */
    editElsewhere(change: (project: Record<string, unknown>) => Record<string, unknown>, id = 'gist1') {
      const g = gists.get(id)!;
      const f = Object.values(g.files)[0]!;
      f.content = JSON.stringify(change(JSON.parse(f.content) as Record<string, unknown>), null, 2) + '\n';
      g.version += 1;
      g.updated_at = tick();
    },
  };
}
