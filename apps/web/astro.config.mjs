import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  site: 'https://www.mullnyphotos.cz',
  trailingSlash: 'always',
  build: { format: 'directory' },
});
