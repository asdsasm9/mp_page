// Restore planner (plan WP-08, T-190): validates a backup document and writes restore SQL. Offline only.
// Usage: npm run restore-plan -- --help
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { run } from './restore-plan/cli';

process.exitCode = run(process.argv.slice(2), {
  readFile: (p) => readFileSync(p, 'utf8'),
  writeFile: (p, t) => writeFileSync(p, t, 'utf8'),
  rename: renameSync,
  exists: existsSync,
  log: (l) => console.log(l),
  error: (l) => console.error(l),
});
