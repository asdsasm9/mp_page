import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { buildHeaders } from './headers.ts';

/** Emits `_headers` (CSP with the exact origins of the VITE_* env) next to index.html. */
function adminHeaders(): Plugin {
  let env: Record<string, string> = {};
  return {
    name: 'admin-headers',
    apply: 'build',
    configResolved(config) {
      env = config.env as unknown as Record<string, string>;
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: '_headers', source: buildHeaders(env).text });
    },
  };
}

export default defineConfig({
  plugins: [react(), adminHeaders()],
  build: {
    // Budget (docs/ADMIN.md, WP5-29): initial JS must stay under 300 KB gzip (checked by `npm run admin-prod-check`).
    // The single entry chunk is about 520 kB raw, so Vite's default 500 kB raw warning is raised to 600 kB raw.
    chunkSizeWarningLimit: 600,
    // Fonts stay separate hashed files: the CSP has font-src 'self' and no data:, so a woff2 must never be inlined into the CSS.
    // (Vite's default would inline files under 4 kB; returning undefined keeps the default for everything else.)
    assetsInlineLimit: (filePath: string) => (filePath.endsWith('.woff2') ? false : undefined),
  },
  test: {
    environment: 'jsdom',
    passWithNoTests: false,
  },
});
