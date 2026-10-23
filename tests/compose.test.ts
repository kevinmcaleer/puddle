// compose.yaml must start with plain `docker compose up`: Compose interpolates every service's settings, profiles
// that are off included, so a required variable (${VAR:?…}) on any service stops the stack for everyone. Each
// optional service keeps its own checks (puddle-connect refuses to start without its token) and stays behind a profile.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';

type Service = { profiles?: string[]; environment?: Record<string, string>; depends_on?: Record<string, unknown> };

const text = readFileSync(join(__dirname, '../compose.yaml'), 'utf8');
const compose = load(text) as { services: Record<string, Service> };
const template = readFileSync(join(__dirname, '../.env.example'), 'utf8');

// The template's settings, set (`NAME=value`) or commented out (`#NAME=value`).
function templateSettings(): Map<string, { value: string; set: boolean }> {
  const settings = new Map<string, { value: string; set: boolean }>();
  for (const line of template.split('\n')) {
    const match = /^(#?)([A-Z_]+)=(.*)$/.exec(line);
    if (match) settings.set(match[2]!, { value: match[3]!, set: match[1] === '' });
  }
  return settings;
}

describe('compose.yaml', () => {
  it('requires no variable, so plain `docker compose up` starts without a .env file', () => {
    expect(text).not.toMatch(/\$\{[A-Z_]+:?\?/);
  });

  it('starts only Puddle itself without a profile', () => {
    const always = Object.entries(compose.services).filter(([, s]) => !s.profiles?.length).map(([name]) => name);
    expect(always).toEqual(['puddle']);
    expect(compose.services.connect!.profiles).toEqual(['connect']);
  });
});

describe('.env.example', () => {
  const settings = templateSettings();

  it('lists every variable compose.yaml reads', () => {
    const used = new Set([...text.matchAll(/\$\{([A-Z_]+)/g)].map((m) => m[1]!));
    expect([...used].filter((name) => !settings.has(name))).toEqual([]);
  });

  it('starts the tunnel with plain `docker compose up`, through a profile compose.yaml has', () => {
    const profiles = new Set(Object.values(compose.services).flatMap((s) => s.profiles ?? []));
    const listed = settings.get('COMPOSE_PROFILES');
    expect(listed?.set).toBe(true);
    const names = listed!.value.split(',').map((p) => p.trim());
    expect(names).toContain('tunnel');
    expect(names.filter((name) => !profiles.has(name))).toEqual([]);
    expect(compose.services.cloudflared!.profiles).toEqual(['tunnel']);
  });

  it('gives cloudflared the token and waits for Puddle, which the public hostname reaches as http://puddle:8080', () => {
    const cloudflared = compose.services.cloudflared!;
    expect(cloudflared.environment?.TUNNEL_TOKEN).toBe('${CLOUDFLARE_TUNNEL_TOKEN:-}');
    expect(cloudflared.depends_on).toHaveProperty('puddle');
    expect(text).toContain(":8080']");
  });

  it('holds no secret: every token is left empty', () => {
    const tokens = [...settings].filter(([name]) => name.endsWith('_TOKEN'));
    expect(tokens.map(([name]) => name)).toEqual(['CLOUDFLARE_TUNNEL_TOKEN', 'PUDDLE_CONNECT_TOKEN']);
    expect(tokens.filter(([, s]) => s.value !== '')).toEqual([]);
    // A Cloudflare tunnel token is base64 JSON, starting eyJ.
    expect(template).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/);
  });

  it('is not ignored, while .env is', () => {
    const ignored = readFileSync(join(__dirname, '../.gitignore'), 'utf8').split('\n');
    expect(ignored).toContain('.env');
    expect(ignored.filter((line) => line.startsWith('.env') && line !== '.env')).toEqual([]);
  });
});
