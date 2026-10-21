// Backup tool (plan WP-08, T-192): catalog.json + photo masters into a local folder. Read-only; dry-run by default.
// Usage: npm run backup -- --help
import { readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nodeFs } from './backup/node-fs';
import { run } from './backup/cli';

process.exitCode = await run(process.argv.slice(2), {
  env: process.env,
  cwd: process.cwd(),
  repoRoot: resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  fs: nodeFs,
  async listDir(path) {
    try {
      return await readdir(path);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  },
  log: (l) => console.log(l),
  error: (l) => console.error(l),
});
