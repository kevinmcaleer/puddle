import tokens from '../design-system/tokens.json';
import { iconSvg, tokenColour, webManifest } from './manifest';

describe('web app manifest', () => {
  it('takes its colours from the design tokens', () => {
    const m = webManifest(tokens);
    expect(m).toMatchObject({ name: 'Puddle', display: 'standalone', start_url: './' });
    expect(m.theme_color).toBe(tokenColour(tokens, 'surface-panel'));
    expect(m.background_color).toBe(tokenColour(tokens, 'surface-canvas'));
    expect(iconSvg(tokens)).toContain(`fill="${tokenColour(tokens, 'brand')}"`);
    expect(iconSvg(tokens)).toContain('>Puddle</text>');
  });

  it('refuses a token that doesn’t exist', () => {
    expect(() => tokenColour(tokens, 'no-such-token')).toThrow(/No colour token/);
  });
});
