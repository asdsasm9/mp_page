import react from '@vitejs/plugin-react';
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
        test: { name: 'admin', root: './apps/admin', environment: 'jsdom' },
      },
      { test: { name: 'web', root: './apps/web', environment: 'node' } },
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
