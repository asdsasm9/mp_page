import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  site: 'https://www.mullnyphotos.cz',
  trailingSlash: 'always',
  // Styles stay external files so the CSP can use style-src 'self' (plan 4.7).
  build: { format: 'directory', inlineStylesheets: 'never' },
});
