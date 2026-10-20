// Test helper: a temporary reportDir for every test that runs main or the planner, removed after the file's tests,
// so the tests leave the repo's migration-report/ untouched.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';

const dirs: string[] = [];

export function tempReportDir(prefix = 'mig-rep-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
