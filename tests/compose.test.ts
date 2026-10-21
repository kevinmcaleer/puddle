// compose.yaml must start with plain `docker compose up`: Compose interpolates every service's settings, profiles
// that are off included, so a required variable (${VAR:?…}) on any service stops the stack for everyone. Each
// optional service keeps its own checks (puddle-connect refuses to start without its token) and stays behind a profile.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';

const text = readFileSync(join(__dirname, '../compose.yaml'), 'utf8');
const compose = load(text) as { services: Record<string, { profiles?: string[] }> };

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
