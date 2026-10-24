import react from '@vitejs/plugin-react';
import { getViteConfig } from 'astro/config';
import { defineConfig } from 'vitest/config';

// One run for the whole repo: `vitest run` (never watch). Each workspace is a project.
export default defineConfig({
  test: {
    passWithNoTests: false,
    watch: false,
    projects: [
      { test: { name: 'shared', root: './packages/shared', environment: 'node' } },
      { test: { name: 'api', root: './apps/api', environment: 'node' } },
      {
        plugins: [react()],
        test: { name: 'admin', root: './apps/admin', environment: 'jsdom', testTimeout: 30000, hookTimeout: 30000 },
      },
      {
        test: {
          name: 'web',
          root: './apps/web',
          environment: 'node',
          exclude: ['**/node_modules/**', '**/*.render.test.ts'],
        },
      },
      // .astro component render tests (Astro container API) need Astro's own vite plugins.
      getViteConfig({
        test: {
          name: 'web-render',
          root: './apps/web',
          environment: 'node',
          include: ['src/**/*.render.test.ts'],
        },
      }),
      {
        test: {
          name: 'scripts',
          root: './scripts',
          environment: 'node',
          include: ['**/*.test.{mjs,ts}'],
        },
      },
      { test: { name: 'supabase', root: './supabase', environment: 'node', testTimeout: 60000 } },
    ],
  },
});
