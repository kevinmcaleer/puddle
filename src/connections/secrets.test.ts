import { forgetAllSecrets, forgetSecret, hasSecret, rememberSecret, secretFor, useSecrets } from './secrets';

describe('connection secrets', () => {
  afterEach(() => forgetAllSecrets());

  it('keeps a secret in memory for the tab and says which ids have one', () => {
    expect(secretFor('c1')).toBeUndefined();
    rememberSecret('c1', 'hunter2');
    expect(secretFor('c1')).toBe('hunter2');
    expect(hasSecret('c1')).toBe(true);
    expect(useSecrets.getState().ids).toEqual(['c1']);
    forgetSecret('c1');
    expect(hasSecret('c1')).toBe(false);
    expect(useSecrets.getState().ids).toEqual([]);
  });

  it('forgets every secret at once', () => {
    rememberSecret('c1', 'a');
    rememberSecret('c2', 'b');
    forgetAllSecrets();
    expect(hasSecret('c1')).toBe(false);
    expect(hasSecret('c2')).toBe(false);
  });

  it('works without session storage (Node has none)', () => {
    expect(typeof sessionStorage).toBe('undefined');
    rememberSecret('c1', 'x');
    expect(secretFor('c1')).toBe('x');
  });
});
