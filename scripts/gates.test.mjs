import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CHECKS,
  QUOTA_GUARD_FILE,
  QUOTA_GUARD_TITLES,
  WRANGLER_TOML,
  checkApiHygiene,
  checkQuotaGuardTests,
  checkEnvExampleSane,
  checkMigrationsLint,
  checkNoDeadDeps,
  checkNoDirectR2,
  checkNoEnvFiles,
  checkNoGaInDist,
  checkNoLegacyIds,
  checkNoSecrets,
  checkNoServiceRole,
  loadFiles,
  runChecks,
  walk,
} from './gates.mjs';

const f = (path, text = '') => ({ path, text });
// Fake secrets are assembled at runtime so this file never contains a secret-shaped literal.
const fakeJwt = ['eyJ', 'hbGciOiJIUzI1NiJ9', '.', 'eyJzdWIiOiJ4eHh4eHgifQ', '.', 'c2lnbmF0dXJl'].join('');
const fakeRole = ['service', 'role'].join('_');
const fakeGa = ['G-7QEZ', 'CZ09WY'].join('');
const fakeGtm = ['GTM-5XB', '7XDT'].join('');
const status = (r) => r.status;

describe('no-secrets', () => {
  it('passes clean files', () => expect(status(checkNoSecrets([f('a.ts', 'const x = 1')]))).toBe('PASS'));
  it('fails on a JWT', () =>
    expect(status(checkNoSecrets([f('a.ts', `const t = "${fakeJwt}"`)]))).toBe('FAIL'));
  it('fails on a private key block', () =>
    expect(status(checkNoSecrets([f('a.txt', '-----BEGIN PRIVATE KEY-----')]))).toBe('FAIL'));
  it('fails on a long value next to "secret"', () =>
    expect(status(checkNoSecrets([f('a.ts', `secret = "${'a1'.repeat(20)}"`)]))).toBe('FAIL'));
  it('ignores docs and legacy', () =>
    expect(status(checkNoSecrets([f('docs/x.md', fakeJwt), f('legacy/y.js', fakeJwt)]))).toBe('PASS'));
});

describe('no-service-role', () => {
  it('passes clean', () => expect(status(checkNoServiceRole([f('a.ts', 'x')]))).toBe('PASS'));
  it('fails in app code', () =>
    expect(status(checkNoServiceRole([f('apps/api/src/a.ts', `use ${fakeRole}`)]))).toBe('FAIL'));
  it('allows supabase sql', () =>
    expect(status(checkNoServiceRole([f('supabase/migrations/a.sql', `grant to ${fakeRole}`)]))).toBe('PASS'));
});

describe('no-env-files', () => {
  it('passes with only .env.example', () =>
    expect(status(checkNoEnvFiles([f('.env.example'), f('a.ts')]))).toBe('PASS'));
  it.each(['.env', '.env.local', 'apps/api/.dev.vars'])('fails on %s', (p) =>
    expect(status(checkNoEnvFiles([f(p)]))).toBe('FAIL'),
  );
});

describe('env-example-sane', () => {
  it('passes names with empty values and comments', () =>
    expect(status(checkEnvExampleSane([f('.env.example', '# c\n\nA_B=\n# C=\n')]))).toBe('PASS'));
  it('fails on a value', () =>
    expect(status(checkEnvExampleSane([f('.env.example', 'A_B=hello\n')]))).toBe('FAIL'));
  it('fails on a malformed line', () =>
    expect(status(checkEnvExampleSane([f('.env.example', 'oops\n')]))).toBe('FAIL'));
  it('allows an explicitly allowed default', () =>
    expect(status(checkEnvExampleSane([f('.env.example', 'MODE=dev\n')], { MODE: 'dev' }))).toBe('PASS'));
  it('fails when the file is missing', () => expect(status(checkEnvExampleSane([]))).toBe('FAIL'));
});

describe('no-legacy-ids', () => {
  it('passes clean', () => expect(status(checkNoLegacyIds([f('a.ts', 'x')]))).toBe('PASS'));
  it.each([fakeGa, fakeGtm])('fails on %s', (id) =>
    expect(status(checkNoLegacyIds([f('apps/web/a.astro', id)]))).toBe('FAIL'),
  );
  it('allows docs', () => expect(status(checkNoLegacyIds([f('docs/a.md', fakeGa)]))).toBe('PASS'));
});

describe('no-dead-deps', () => {
  const pkg = (deps) => f('apps/x/package.json', JSON.stringify({ dependencies: deps }));
  it('passes clean', () => expect(status(checkNoDeadDeps([pkg({ react: '18.3.1' })]))).toBe('PASS'));
  it.each(['react-scripts', 'react-ga4', 'gh-pages', 'react-router-dom'])('fails on %s', (d) =>
    expect(status(checkNoDeadDeps([pkg({ [d]: '1.0.0' })]))).toBe('FAIL'),
  );
  it('allows react-router-dom in apps/admin only (D-9)', () => {
    const admin = f('apps/admin/package.json', JSON.stringify({ dependencies: { 'react-router-dom': '7.18.4' } }));
    const lock = (k) => f('package-lock.json', JSON.stringify({ packages: { [k]: { dependencies: { 'react-router-dom': '7' } } } }));
    expect(status(checkNoDeadDeps([admin]))).toBe('PASS');
    expect(status(checkNoDeadDeps([lock('apps/admin')]))).toBe('PASS');
    expect(status(checkNoDeadDeps([lock('apps/web')]))).toBe('FAIL');
  });
  it('checks lockfile workspace entries but not node_modules entries', () => {
    const ok = f('package-lock.json', JSON.stringify({ packages: { 'node_modules/x': { dependencies: { 'gh-pages': '1' } } } }));
    const bad = f('package-lock.json', JSON.stringify({ packages: { '': { dependencies: { 'gh-pages': '1' } } } }));
    expect(status(checkNoDeadDeps([ok]))).toBe('PASS');
    expect(status(checkNoDeadDeps([bad]))).toBe('FAIL');
  });
});

describe('no-direct-r2', () => {
  it('passes clean', () => expect(status(checkNoDirectR2([f('a.ts', 'x')]))).toBe('PASS'));
  it('fails outside storage folders', () =>
    expect(status(checkNoDirectR2([f('apps/api/src/a.ts', "import 'aws4fetch'")]))).toBe('FAIL'));
  it('allows the storage folders', () =>
    expect(status(checkNoDirectR2([f('apps/api/src/storage/r2.ts', 'R2Bucket')]))).toBe('PASS'));
});

describe('no-ga-in-dist', () => {
  it('skips with no dist', () => expect(status(checkNoGaInDist([]))).toBe('SKIP'));
  it('passes clean html', () =>
    expect(status(checkNoGaInDist([f('apps/web/dist/index.html', '<html></html>')]))).toBe('PASS'));
  it('fails on gtag', () =>
    expect(status(checkNoGaInDist([f('apps/web/dist/index.html', 'gtag("js")')]))).toBe('FAIL'));
  it('fails on googletagmanager', () =>
    expect(
      status(checkNoGaInDist([f('apps/web/dist/a/index.html', '<script src="//www.googletagmanager.com/x">')])),
    ).toBe('FAIL'));
});

describe('migrations-lint', () => {
  const lintFiles = [f('supabase/tests/lint.test.ts'), f('supabase/tests/golden/privilege-matrix.json')];
  const mig = (name, text = 'create table public.t (id int);') => f(`supabase/migrations/${name}`, text);
  const run = (...files) => checkMigrationsLint([...files, ...lintFiles]);
  it('passes ordered migrations', () =>
    expect(status(run(mig('20261019100000_a.sql'), mig('20261019100100_b.sql')))).toBe('PASS'));
  it('fails with no migrations', () => expect(status(checkMigrationsLint(lintFiles))).toBe('FAIL'));
  it('fails on a badly named file', () => expect(status(run(mig('1_a.sql')))).toBe('FAIL'));
  it('fails on a duplicate timestamp', () =>
    expect(status(run(mig('20261019100000_a.sql'), mig('20261019100000_b.sql')))).toBe('FAIL'));
  it('fails on grant to public and using (true)', () => {
    expect(status(run(mig('20261019100000_a.sql', 'grant select on public.t to public;')))).toBe('FAIL');
    expect(status(run(mig('20261019100000_a.sql', 'create policy p on public.t using (true);')))).toBe('FAIL');
  });
  it('fails on service role but ignores comments and "into public."', () => {
    expect(status(run(mig('20261019100000_a.sql', `grant all on public.t to ${fakeRole};`)))).toBe('FAIL');
    expect(status(run(mig('20261019100000_a.sql', `-- ${fakeRole} to public\ninsert into public.t values (1);`)))).toBe('PASS');
  });
  it('fails when the catalog lint test or golden file is missing', () =>
    expect(status(checkMigrationsLint([mig('20261019100000_a.sql')]))).toBe('FAIL'));
});

const quotaSuite = (skip = -1) =>
  QUOTA_GUARD_TITLES.filter((_, i) => i !== skip)
    .map((t) => `  it('${t.replace(/'/g, "\\'")}', async () => {});`)
    .join('\n');

describe('quota-guard-tests', () => {
  const run = (text) => checkQuotaGuardTests(text === null ? [] : [f(QUOTA_GUARD_FILE, text)]);
  it('passes with all eleven titles', () => {
    expect(QUOTA_GUARD_TITLES).toHaveLength(11);
    expect(status(run(quotaSuite()))).toBe('PASS');
  });
  it('fails when the file is missing', () => expect(status(run(null))).toBe('FAIL'));
  it('fails when any one case is removed or renamed', () => {
    for (let i = 0; i < QUOTA_GUARD_TITLES.length; i++) {
      const r = run(quotaSuite(i));
      expect(status(r)).toBe('FAIL');
      expect(r.details).toContain(QUOTA_GUARD_TITLES[i]);
    }
  });
  it('does not accept a title that is only in a comment', () =>
    expect(status(run(`${quotaSuite(0)}\n// ${QUOTA_GUARD_TITLES[0]}`))).toBe('FAIL'));
});

describe('api-hygiene', () => {
  const toml = (text) => f(WRANGLER_TOML, text);
  const good = 'name = "mullnyphotos-api"\n# TOKEN = "x"\n[triggers]\ncrons = ["17 3 * * *"]\n';
  it('passes a clean wrangler.toml and clean sources', () =>
    expect(status(checkApiHygiene([toml(good), f('apps/api/src/a.ts', 'console.info("ok")')]))).toBe('PASS'));
  it('fails when wrangler.toml is missing', () => expect(status(checkApiHygiene([]))).toBe('FAIL'));
  it('fails on a [vars] section', () =>
    expect(status(checkApiHygiene([toml(`${good}[vars]\nA = "b"\n`)]))).toBe('FAIL'));
  it('fails on a secret-named assignment', () =>
    expect(status(checkApiHygiene([toml(`${good}R2_SECRET_ACCESS_KEY = "b"\n`)]))).toBe('FAIL'));
  it('fails on a key-shaped value', () =>
    expect(status(checkApiHygiene([toml(`${good}x = "${'a1B2'.repeat(10)}"\n`)]))).toBe('FAIL'));
  it('fails on a console call that mentions authorization, ignores tests', () => {
    const line = 'console.log(request.headers.get("authorization"))';
    expect(status(checkApiHygiene([toml(good), f('apps/api/src/a.ts', line)]))).toBe('FAIL');
    expect(status(checkApiHygiene([toml(good), f('apps/api/src/a.test.ts', line)]))).toBe('PASS');
  });
});

describe('registry and runner', () => {
  const inputs = {
    files: [
      f('.env.example', 'A=\n'),
      f('supabase/migrations/20261019100000_a.sql', 'create table public.t (id int);'),
      f('supabase/tests/lint.test.ts'),
      f('supabase/tests/golden/privilege-matrix.json'),
      f(QUOTA_GUARD_FILE, quotaSuite()),
      f(WRANGLER_TOML, 'name = "x"\n'),
    ],
    dist: [],
  };
  it('page-checks is SKIP without dist (no site input)', () => {
    expect(runChecks(inputs).rows.find((r) => r.name === 'page-checks').status).toBe('SKIP');
  });
  it('budget is SKIP without dist (no site input)', () => {
    expect(runChecks(inputs).rows.find((r) => r.name === 'budget').status).toBe('SKIP');
  });
  it('has the 1 pending check with an owner', () => {
    const pend = runChecks(inputs).rows.filter((r) => r.status === 'PENDING');
    expect(pend.map((r) => r.name)).toEqual(['docs-complete']);
    expect(pend.every((r) => /WP-\d/.test(r.details))).toBe(true);
  });
  it('exits 0 normally and 1 with --strict', () => {
    expect(runChecks(inputs).exitCode).toBe(0);
    expect(runChecks(inputs, { strict: true }).exitCode).toBe(1);
  });
  it('exits 1 when a check fails', () => {
    expect(runChecks({ files: [f('.env', ''), f('.env.example', '')], dist: [] }).exitCode).toBe(1);
  });
  it('names are unique', () => {
    const names = CHECKS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('file loading from a fixture dir under .tmp', () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '.tmp', 'gates-fixture');
  it('walks and loads text, skips binaries', () => {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, 'sub'), { recursive: true });
    writeFileSync(join(dir, 'sub', 'a.txt'), 'hello');
    writeFileSync(join(dir, 'b.jpg'), 'not text');
    const paths = walk(dir).sort();
    expect(paths).toEqual(['b.jpg', 'sub/a.txt']);
    expect(loadFiles(dir, paths)).toEqual([{ path: 'sub/a.txt', text: 'hello' }]);
    rmSync(dir, { recursive: true, force: true });
  });
});
