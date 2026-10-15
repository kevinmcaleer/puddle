// The web app manifest and icon, made from the design system's colour tokens at build time.

interface Tokens {
  color: { tokens: { name: string; value: { light: string; dark: string } }[] };
}

export function tokenColour(tokens: Tokens, name: string, theme: 'light' | 'dark' = 'light'): string {
  const t = tokens.color.tokens.find((x) => x.name === name);
  if (!t) throw new Error(`No colour token ${name}.`);
  return t.value[theme];
}

export function webManifest(tokens: Tokens) {
  return {
    name: 'Puddle',
    short_name: 'Puddle',
    description: 'Turn messy data into tidy data in your browser. Nothing leaves your browser.',
    start_url: './',
    scope: './',
    display: 'standalone',
    theme_color: tokenColour(tokens, 'surface-panel'),
    background_color: tokenColour(tokens, 'surface-canvas'),
    icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  };
}

/** The wordmark on the brand colour; there's no logo yet. */
export function iconSvg(tokens: Tokens): string {
  const bg = tokenColour(tokens, 'brand');
  const fg = tokenColour(tokens, 'on-brand');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="96" fill="${bg}"/><text x="256" y="300" text-anchor="middle" font-family="system-ui, sans-serif" font-size="128" font-weight="700" letter-spacing="-2" fill="${fg}">Puddle</text></svg>`;
}
