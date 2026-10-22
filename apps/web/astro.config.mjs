import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  site: 'https://www.mullnyphotos.cz',
  trailingSlash: 'always',
  // Styles stay external files so the CSP can use style-src 'self' (plan 4.7).
  build: { format: 'directory', inlineStylesheets: 'never' },
  // Island scripts (menu, lightbox) stay external files, so script-src 'self' covers them without hashes.
  vite: { build: { assetsInlineLimit: 0 } },
});
