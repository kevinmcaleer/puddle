import type { Config } from 'tailwindcss';
import puddle from './src/design-system/tailwind.preset.js';

export default {
  presets: [puddle as Config],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // Colours, spacing, radii and type come only from the Puddle preset, so nothing resolves outside the tokens.
  corePlugins: { preflight: true },
} satisfies Config;
