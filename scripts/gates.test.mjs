import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ARCH_GOLDEN,
  CHECKS,
  ENV_DOCS_ONLY,
  FAKE_WORLD_MARKER,
  QUOTA_GUARD_FILE,
  QUOTA_GUARD_TITLES,
  WRANGLER_TOML,
  checkAdminDistExternalHosts,
  checkAdminDistNoAnalytics,
  checkAdminDistNoFakeMarker,
  checkAdminDistNoKeyStrings,
  checkAdminDistNoPassword,
  checkNoPasswordCode,
  checkAnalyticsInDist,
  checkAnalyticsNotInAdminOrApi,
  checkAdminNoHtmlInjection,
  checkAdminNoLimitLiterals,
  checkAdminNoPhotoWrites,
  checkAdminNoR2Hosts,
  checkAdminNoServiceKey,
  checkAdminNoSignUp,
  checkMigrateNoCredentials,
  checkMigrateNoPhotoWrites,
  checkMigrateNoR2,
  checkMigrateNoServiceKey,
  checkMigrateNoSignUp,
  envUrlHosts,
  checkApiHygiene,
  checkArchComponents,
  checkArchDataModel,
  checkQuotaGuardTests,
  checkEnvExampleSane,
  checkEnvExampleComplete,
  gitPaths,
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
import { apiDefaults, apiFiles, apiGolden } from './api-surface.fixtures.mjs';

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

describe('env-example-complete', () => {
  const code = f('apps/web/src/lib/env.ts', 'export const a = import.meta.env.PUBLIC_ONE;\nexport const b = import.meta.env.PUBLIC_TWO;\n');
  const example = '# one\nPUBLIC_ONE=\n# two\nPUBLIC_TWO=\n';
  const run = (text, extra = [], docsOnly = {}) =>
    checkEnvExampleComplete([code, ...extra, f('.env.example', text)], docsOnly);
  it('passes when documented names equal the names the code reads', () => expect(run(example).status).toBe('PASS'));
  it('fails when a read name is removed from the example and names it', () => {
    const r = run('# one\nPUBLIC_ONE=\n');
    expect(r.status).toBe('FAIL');
    expect(r.details).toContain('PUBLIC_TWO');
  });
  it('fails when a documented name is read by nothing', () => {
    const r = run(`${example}# ghost\nGHOST_NAME=\n`);
    expect(r.status).toBe('FAIL');
    expect(r.details).toContain('GHOST_NAME');
  });
  it('fails on a name without a comment above, and on a duplicate', () => {
    expect(run('# one\nPUBLIC_ONE=\nPUBLIC_TWO=\n').status).toBe('FAIL');
    expect(run(`${example}# again\nPUBLIC_ONE=\n`).details).toContain('twice');
  });
  it('ignores names read only in tests', () => {
    const t = f('apps/web/src/lib/env.test.ts', 'process.env.ONLY_TEST');
    expect(run(example, [t]).status).toBe('PASS');
  });
  it('accepts a commented secret name with a comment above', () => {
    const w = f('apps/api/src/env.ts', "const names = ['SECRET_ONE']");
    expect(run(`${example}# secret\n# SECRET_ONE=\n`, [w]).status).toBe('PASS');
  });
  it('docs-only exception passes with a reason comment and the listed entry', () => {
    const text = `${example}# docs-only: read by a test only\n# TEST_ONLY=\n`;
    expect(run(text, [], { TEST_ONLY: 'tests' }).status).toBe('PASS');
  });
  it('docs-only exception fails without the reason comment, when unlisted, or when stale', () => {
    expect(run(`${example}# plain comment\n# TEST_ONLY=\n`, [], { TEST_ONLY: 'tests' }).status).toBe('FAIL');
    expect(run(`${example}# docs-only: x\n# TEST_ONLY=\n`).status).toBe('FAIL');
    expect(run(example, [], { TEST_ONLY: 'tests' }).details).toContain('TEST_ONLY');
    expect(run(example, [], { PUBLIC_ONE: 'tests' }).status).toBe('FAIL');
  });
  it('fails when .env.example is missing', () => expect(checkEnvExampleComplete([code]).status).toBe('FAIL'));
  it('the real repo is green', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const files = loadFiles(root, gitPaths(root));
    const r = checkEnvExampleComplete(files);
    expect(r.status, r.details).toBe('PASS');
    expect(checkEnvExampleSane(files).status).toBe('PASS');
  });
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

describe('analytics isolation (WP7-5)', () => {
  const tok = 'a1B2c3D4e5F6g7H8';
  const beacon = `<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon="{&quot;token&quot;:&quot;${tok}&quot;}"></script>`;
  const beaconSingle = `<script data-cf-beacon='{"token": "${tok}"}' src="https://static.cloudflareinsights.com/beacon.min.js" type="module"></script>`;
  const web = (text, path = 'apps/web/dist/index.html') => [f(path, `<html><head>${text}</head></html>`)];
  it('web dist may carry exactly the one beacon tag', () => {
    expect(status(checkAnalyticsInDist(web('')))).toBe('PASS');
    expect(status(checkAnalyticsInDist(web(beacon)))).toBe('PASS');
    expect(status(checkAnalyticsInDist(web(beaconSingle)))).toBe('PASS');
    expect(status(checkAnalyticsInDist([]))).toBe('SKIP');
  });
  it('web dist fails on a second tag, a changed tag or the words elsewhere', () => {
    expect(status(checkAnalyticsInDist(web(beacon + beacon)))).toBe('FAIL');
    expect(status(checkAnalyticsInDist(web(beacon.replace('beacon.min.js', 'other.js'))))).toBe('FAIL');
    expect(status(checkAnalyticsInDist(web(beacon.replace('<script ', '<script async '))))).toBe('FAIL');
    expect(status(checkAnalyticsInDist(web(beacon.replace('></script>', '>x=1</script>'))))).toBe('FAIL');
    expect(status(checkAnalyticsInDist(web('<img src="https://static.cloudflareinsights.com/p.png">')))).toBe('FAIL');
    expect(status(checkAnalyticsInDist(web('<p>cloudflareinsights</p>')))).toBe('FAIL');
    expect(status(checkAnalyticsInDist(web(beacon.replace(tok, 'x'))))).toBe('FAIL');
  });
  it('admin dist html fails on any beacon text, even the exact tag', () => {
    expect(status(checkAnalyticsInDist(web(beacon, 'apps/admin/dist/index.html')))).toBe('FAIL');
    expect(status(checkAnalyticsInDist(web('<script data-cf-beacon="{}"></script>', 'apps/admin/dist/index.html')))).toBe('FAIL');
    expect(status(checkAnalyticsInDist(web('', 'apps/admin/dist/index.html')))).toBe('PASS');
  });
  it('google strings still fail no-ga-in-dist next to the beacon', () => {
    expect(status(checkNoGaInDist(web(beacon)))).toBe('PASS');
    expect(status(checkNoGaInDist(web(beacon + '<script src="//www.googletagmanager.com/x"></script>')))).toBe('FAIL');
  });
  it('admin dist js, css and html fail on beacon strings', () => {
    for (const text of ['x="cloudflareinsights"', 'data-cf-beacon', 'import "beacon.min.js"']) {
      expect(status(checkAdminDistNoAnalytics([f('apps/admin/dist/assets/a.js', text)]))).toBe('FAIL');
      expect(status(checkAdminDistNoAnalytics([f('.tmp/admin-prod/site/index.html', text)]))).toBe('FAIL');
    }
    expect(status(checkAdminDistNoAnalytics([f('apps/admin/dist/assets/a.js', 'x=1')]))).toBe('PASS');
    expect(status(checkAdminDistNoAnalytics([f('apps/web/dist/a.js', 'cloudflareinsights')]))).toBe('SKIP');
  });
  it('admin source and api fail on the beacon, tests and web are ignored', () => {
    expect(status(checkAnalyticsNotInAdminOrApi([f('apps/admin/src/a.tsx', 'const h = "data-cf-beacon"')]))).toBe('FAIL');
    expect(status(checkAnalyticsNotInAdminOrApi([f('apps/api/src/a.ts', 'https://static.cloudflareinsights.com')]))).toBe('FAIL');
    expect(status(checkAnalyticsNotInAdminOrApi([f('apps/api/wrangler.toml', 'beacon.min.js')]))).toBe('FAIL');
    expect(status(checkAnalyticsNotInAdminOrApi([f('apps/admin/src/a.test.tsx', 'cloudflareinsights')]))).toBe('PASS');
    expect(status(checkAnalyticsNotInAdminOrApi([f('apps/web/src/lib/beacon.ts', 'cloudflareinsights')]))).toBe('PASS');
  });
  it('the rules are registered', () => {
    const names = CHECKS.map((c) => c.name);
    for (const n of ['analytics-in-dist', 'analytics-not-admin', 'admin-dist-no-analytics']) expect(names).toContain(n);
  });
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

describe('admin source rules (WP5-30)', () => {
  const src = (text, path = 'apps/admin/src/a.ts') => [f(path, text)];
  const cases = [
    ['admin-no-service-key', checkAdminNoServiceKey, `const k = '${fakeRole}'`, 'const k = 1'],
    ['admin-no-service-key (name)', checkAdminNoServiceKey, 'const SERVICE_KEY = 1', 'const key = 1'],
    ['admin-no-signup', checkAdminNoSignUp, 'await auth.signUp({ email })', 'await auth.signIn()'],
    ['admin-no-html-inject (React)', checkAdminNoHtmlInjection, '<div dangerouslySetInnerHTML={{ __html: x }} />', '<div>{x}</div>'],
    ['admin-no-html-inject (innerHTML)', checkAdminNoHtmlInjection, 'el.innerHTML = x', 'el.textContent = x'],
    ['admin-no-html-inject (insertAdjacentHTML)', checkAdminNoHtmlInjection, "el.insertAdjacentHTML('beforeend', x)", 'el.append(x)'],
    ['admin-no-photo-writes (insert)', checkAdminNoPhotoWrites, "rest.insert('photos', row)", "rest.insert('albums', row)"],
    ['admin-no-photo-writes (remove generic)', checkAdminNoPhotoWrites, "rest.remove<Row>('photos', q)", "rest.select('photos', q)"],
    ['admin-no-photo-writes (from)', checkAdminNoPhotoWrites, "sb.from('photos').delete().eq('id', 1)", "sb.from('photos').select('*')"],
    ['admin-no-r2-hosts', checkAdminNoR2Hosts, "fetch('https://acc.r2.cloudflarestorage.com/x')", "fetch(presignedUrl)"],
    ['admin-no-r2-hosts (r2.dev)', checkAdminNoR2Hosts, "const u = 'https://pub-1.r2.dev/x'", 'const u = base'],
    ['admin-no-limit-literals (hard)', checkAdminNoLimitLiterals, 'const HARD = 10_000_000_000', 'const HARD = config.hard'],
    ['admin-no-limit-literals (warn)', checkAdminNoLimitLiterals, 'const W = 8000000000', 'const W = 80'],
    ['admin-no-limit-literals (upload)', checkAdminNoLimitLiterals, 'const M = 12_000_000', 'const M = 112_000_000'],
  ];
  for (const [name, check, bad, good] of cases) {
    it(`${name}: fails on a violating fixture, passes a clean one`, () => {
      expect(status(check(src(bad)))).toBe('FAIL');
      expect(status(check(src(good)))).toBe('PASS');
    });
  }
  it('ignores tests and files outside apps/admin/src', () => {
    expect(status(checkAdminNoHtmlInjection(src('el.innerHTML = x', 'apps/admin/src/a.test.ts')))).toBe('PASS');
    expect(status(checkAdminNoHtmlInjection(src('el.innerHTML = x', 'apps/web/src/a.ts')))).toBe('PASS');
  });
  it('the real catalog-style reads of photos are allowed', () => {
    expect(status(checkAdminNoPhotoWrites(src("rest.select<PhotoRow>('photos', q); update<PhotoRow>('photos', id, p)")))).toBe('PASS');
  });
});

describe('migrate-legacy source rules (WP6-13)', () => {
  const src = (text, path = 'scripts/migrate-legacy/http-backend.ts') => [f(path, text)];
  const cases = [
    ['migrate-no-service-key', checkMigrateNoServiceKey, `const k = '${fakeRole}'`, 'const k = anonKey'],
    ['migrate-no-service-key (name)', checkMigrateNoServiceKey, 'const serviceKey = 1', 'const key = 1'],
    ['migrate-no-signup', checkMigrateNoSignUp, 'await auth.signUp({ email })', 'await auth.signInWithPassword()'],
    ['migrate-no-signup (admin)', checkMigrateNoSignUp, 'await sb.auth.admin.createUser({})', 'await sb.auth.getUser()'],
    ['migrate-no-signup (endpoint)', checkMigrateNoSignUp, "fetch(`${u}/auth/v1/signup`)", "fetch(`${u}/auth/v1/token`)"],
    ['migrate-no-photo-writes (rest POST)', checkMigrateNoPhotoWrites, "rest<PhotoRow>('POST', 'photos', {}, row)", "rest<AlbumRow>('POST', 'albums', {}, row)"],
    ['migrate-no-photo-writes (rest PATCH)', checkMigrateNoPhotoWrites, "rest('PATCH', 'photos', q, b)", "rest<AlbumRow>('PATCH', 'albums', q, b)"],
    ['migrate-no-photo-writes (rest DELETE)', checkMigrateNoPhotoWrites, 'rest("DELETE", "photos", q)', "rest<CategoryRow>('POST', 'categories', {}, c)"],
    ['migrate-no-photo-writes (insert helper)', checkMigrateNoPhotoWrites, "db.insert('photos', row)", "db.insert('albums', row)"],
    ['migrate-no-photo-writes (from)', checkMigrateNoPhotoWrites, "sb.from('photos').upsert(rows)", "sb.from('photos').select('*')"],
    ['migrate-no-photo-writes (path literal)', checkMigrateNoPhotoWrites, "fetch(`${u}/rest/v1/photos`)", "fetch(`${u}/rest/v1/${table}`)"],
    ['migrate-no-r2 (endpoint)', checkMigrateNoR2, "fetch('https://acc.r2.cloudflarestorage.com/x')", 'fetch(presignedUrl)'],
    ['migrate-no-r2 (r2.dev)', checkMigrateNoR2, "const u = 'https://pub-1.r2.dev/x'", 'const u = base'],
    ['migrate-no-r2 (aws4fetch)', checkMigrateNoR2, "import { AwsClient } from 'aws4fetch'", "import { fetch } from 'undici'"],
    ['migrate-no-r2 (@aws-sdk)', checkMigrateNoR2, "import { S3Client } from '@aws-sdk/client-s3'", "import { readFile } from 'node:fs/promises'"],
    ['migrate-no-credentials (JWT)', checkMigrateNoCredentials, `const t = "${fakeJwt}"`, 'const t = process.env.TOKEN'],
    ['migrate-no-credentials (sk_)', checkMigrateNoCredentials, `const k = "${['sk', 'live', 'a1B2c3D4e5F6g7H8i9'].join('_')}"`, 'const k = "sk"'],
    ['migrate-no-credentials (long value)', checkMigrateNoCredentials, `const apiKey = "${'aB3'.repeat(12)}"`, 'const apiKey = env.KEY'],
    ['migrate-no-credentials (private key)', checkMigrateNoCredentials, 'x = "-----BEGIN PRIVATE KEY-----"', 'x = "begin"'],
  ];
  for (const [name, check, bad, good] of cases) {
    it(`${name}: fails on a violating fixture, passes a clean one`, () => {
      expect(status(check(src(bad)))).toBe('FAIL');
      expect(status(check(src(good)))).toBe('PASS');
    });
  }
  it('scans scripts/migrate-legacy.ts, ignores tests and other files', () => {
    expect(status(checkMigrateNoSignUp(src('auth.signUp()', 'scripts/migrate-legacy.ts')))).toBe('FAIL');
    expect(status(checkMigrateNoSignUp(src('auth.signUp()', 'scripts/migrate-legacy/x.test.ts')))).toBe('PASS');
    expect(status(checkMigrateNoSignUp(src('auth.signUp()', 'scripts/migrate-legacy.test.ts')))).toBe('PASS');
    expect(status(checkMigrateNoSignUp(src('auth.signUp()', 'scripts/other.ts')))).toBe('PASS');
  });
  it('the HttpBackend calls (PATCH albums, POST categories/albums, GET photos) are allowed', () => {
    const http = [
      "rest<AlbumRow>('PATCH', 'albums', { id: `eq.${albumId}` }, { cover_photo_id: photoId })",
      "rest<CategoryRow>('POST', 'categories', {}, { id })",
      "rest<AlbumRow>('POST', 'albums', {}, input)",
      "rest<PhotoRow>('GET', 'photos', { select: '*' })",
      'const res = await send(`${supabase}/rest/v1/${table}${qs}`, init)',
    ].join('\n');
    for (const c of [checkMigrateNoServiceKey, checkMigrateNoSignUp, checkMigrateNoPhotoWrites, checkMigrateNoR2, checkMigrateNoCredentials]) {
      expect(status(c(src(http)))).toBe('PASS');
    }
  });
});

describe('no-password-code (WP9-S10)', () => {
  const planted = [
    'await sb.auth.signInWithPassword({ email, password })',
    'await sb.auth.resetPasswordForEmail(email)',
    "body: 'grant_type=password'",
    '<input type="password" />',
    '<input autoComplete="current-password" />',
    'await sb.auth.updateUser({ password: x })',
  ];
  for (const line of planted) {
    it(`fails on the planted line ${line}`, () => {
      expect(status(checkNoPasswordCode([f('apps/admin/src/a.tsx', line)]))).toBe('FAIL');
      expect(status(checkNoPasswordCode([f('scripts/x.ts', line)]))).toBe('FAIL');
    });
  }
  it('passes clean code, tests, gate files and files elsewhere', () => {
    expect(status(checkNoPasswordCode([f('apps/admin/src/a.tsx', 'await sb.auth.signInWithOAuth({ provider: "google" })')]))).toBe('PASS');
    expect(status(checkNoPasswordCode([f('apps/admin/src/a.test.tsx', planted[0])]))).toBe('PASS');
    expect(status(checkNoPasswordCode([f('scripts/gates.mjs', planted[0])]))).toBe('PASS');
    expect(status(checkNoPasswordCode([f('apps/web/src/a.ts', planted[0])]))).toBe('PASS');
  });
  it('the dist gate flags a password field but allows the supabase-js grant_type', () => {
    const dist = (t) => [f('apps/admin/dist/assets/a.js', t)];
    expect(status(checkAdminDistNoPassword([]))).toBe('SKIP');
    expect(status(checkAdminDistNoPassword(dist('createElement("input",{type:"password"})')))).toBe('FAIL');
    expect(status(checkAdminDistNoPassword(dist('<input type="password">')))).toBe('FAIL');
    expect(status(checkAdminDistNoPassword(dist('autocomplete:"current-password"')))).toBe('FAIL');
    expect(status(checkAdminDistNoPassword(dist('grant_type=password;signInWithPassword')))).toBe('PASS');
  });
  it('is registered', () => {
    expect(CHECKS.map((c) => c.name)).toEqual(expect.arrayContaining(['no-password-code', 'admin-dist-no-password']));
  });
});

describe('admin dist rules (WP5-30)', () => {
  const dist = (text, path = 'apps/admin/dist/assets/a.js') => [f(path, text)];
  it('SKIP when no admin build exists', () => {
    for (const c of [checkAdminDistNoFakeMarker, checkAdminDistNoKeyStrings, checkAdminDistExternalHosts]) {
      expect(status(c([]))).toBe('SKIP');
      expect(status(c([f('apps/web/dist/a.js', FAKE_WORLD_MARKER)]))).toBe('SKIP');
    }
  });
  it('fake marker fails in either production dist, clean passes', () => {
    expect(status(checkAdminDistNoFakeMarker(dist(`x="${FAKE_WORLD_MARKER}"`)))).toBe('FAIL');
    expect(status(checkAdminDistNoFakeMarker(dist(`x="${FAKE_WORLD_MARKER}"`, '.tmp/admin-prod/site/assets/a.js')))).toBe('FAIL');
    expect(status(checkAdminDistNoFakeMarker(dist('x=1')))).toBe('PASS');
  });
  it('key-shaped strings fail', () => {
    expect(status(checkAdminDistNoKeyStrings(dist(`k="${fakeJwt}"`)))).toBe('FAIL');
    expect(status(checkAdminDistNoKeyStrings(dist(`k="${['sk', 'live', 'a1B2c3D4e5F6g7H8i9'].join('_')}"`)))).toBe('FAIL');
    expect(status(checkAdminDistNoKeyStrings(dist(`k="${fakeRole}"`)))).toBe('FAIL');
    expect(status(checkAdminDistNoKeyStrings(dist(`apiSecret="${'aB3'.repeat(12)}"`)))).toBe('FAIL');
    expect(status(checkAdminDistNoKeyStrings(dist('k="mock-anon-key"')))).toBe('PASS');
  });
  it('external hosts: libraries and env hosts pass, others fail', () => {
    const env = ['abc.supabase.co'];
    expect(status(checkAdminDistExternalHosts(dist('"https://github.com/x http://www.w3.org/2000/svg"'), env))).toBe('PASS');
    expect(status(checkAdminDistExternalHosts(dist('"https://abc.supabase.co/rest/v1"'), env))).toBe('PASS');
    expect(status(checkAdminDistExternalHosts(dist('"https://evil.example/x"'), env))).toBe('FAIL');
    expect(status(checkAdminDistExternalHosts(dist('"https://abc.supabase.co.evil.example/x"'), env))).toBe('FAIL');
    expect(status(checkAdminDistExternalHosts(dist('"https://abc.supabase.co/rest/v1"'), []))).toBe('FAIL');
  });
  it('envUrlHosts reads VITE_*_URL and *_ORIGIN hosts only', () => {
    expect(envUrlHosts({ VITE_API_BASE_URL: 'https://api.x.test/a', VITE_R2_UPLOAD_ORIGIN: 'https://r2.x.test', VITE_OTHER: 'https://no.test', A_URL: 'https://no2.test' })).toEqual(['api.x.test', 'r2.x.test']);
  });
});

const archGolden = {
  components: {
    rootWorkspaces: ['apps/*', 'packages/*'],
    directories: ['apps/web', 'scripts', 'docs'],
    requiredDeps: { 'apps/web': ['astro', '@mp/shared'], 'packages/shared': ['zod'] },
    forbiddenDeps: ['@astrojs/cloudflare', '@astrojs/node'],
    forbiddenAstroOutputs: ['server', 'hybrid'],
    pinnedExactly: ['astro'],
  },
};
const pkg = (o) => JSON.stringify(o);
const archFiles = (over = {}) => {
  const base = {
    'package.json': pkg({ workspaces: ['apps/*', 'packages/*'] }),
    'apps/web/package.json': pkg({ dependencies: { astro: '7.4.0', '@mp/shared': '0.0.0' } }),
    'packages/shared/package.json': pkg({ dependencies: { zod: '4.6.7' } }),
    'apps/web/astro.config.mjs': "export default defineConfig({ output: 'static' });",
    'scripts/a.mjs': '',
    'docs/a.md': '',
    ...over,
  };
  return Object.entries(base)
    .filter(([, t]) => t !== null)
    .map(([p, t]) => f(p, t));
};

describe('arch-components', () => {
  const run = (over) => checkArchComponents(archFiles(over), archGolden);
  it('passes on a conforming layout', () => expect(run().status).toBe('PASS'));
  it('fails when a workspace directory is missing and names it', () => {
    const r = checkArchComponents(archFiles({ 'docs/a.md': null }), archGolden);
    expect(r.status).toBe('FAIL');
    expect(r.details).toContain('docs');
  });
  it('fails when a workspace package.json is missing', () => {
    expect(run({ 'packages/shared/package.json': null }).status).toBe('FAIL');
  });
  it('fails when the root workspaces differ', () => {
    expect(run({ 'package.json': pkg({ workspaces: ['apps/*'] }) }).status).toBe('FAIL');
  });
  it('fails when a required dependency is missing', () => {
    const r = run({ 'packages/shared/package.json': pkg({ dependencies: {} }) });
    expect(r.status).toBe('FAIL');
    expect(r.details).toContain('zod');
  });
  it('fails on an SSR adapter dependency', () => {
    const r = run({ 'apps/web/package.json': pkg({ dependencies: { astro: '7.4.0', '@mp/shared': '0.0.0', '@astrojs/cloudflare': '1.0.0' } }) });
    expect(r.status).toBe('FAIL');
    expect(r.details).toContain('@astrojs/cloudflare');
  });
  it('fails on astro server or hybrid output, but not when only a comment says so', () => {
    expect(run({ 'apps/web/astro.config.mjs': "export default { output: 'server' };" }).status).toBe('FAIL');
    expect(run({ 'apps/web/astro.config.mjs': 'export default { output: "hybrid" };' }).status).toBe('FAIL');
    expect(run({ 'apps/web/astro.config.mjs': "// output: 'server'\nexport default { output: 'static' };" }).status).toBe('PASS');
  });
  it('fails on an adapter in the astro config', () => {
    expect(run({ 'apps/web/astro.config.mjs': 'export default { adapter: node() };' }).status).toBe('FAIL');
  });
  it('fails when astro uses a ^ or ~ range', () => {
    for (const v of ['^7.4.0', '~7.4.0']) {
      const r = run({ 'apps/web/package.json': pkg({ dependencies: { astro: v, '@mp/shared': '0.0.0' } }) });
      expect(r.status).toBe('FAIL');
      expect(r.details).toContain('astro');
    }
  });
  it('does not gate ranges on other dependencies', () => {
    expect(run({ 'packages/shared/package.json': pkg({ dependencies: { zod: '^4.6.7' } }) }).status).toBe('PASS');
  });
  it('fails when the golden file is missing or broken', () => {
    expect(checkArchComponents(archFiles()).status).toBe('FAIL');
    expect(checkArchComponents([...archFiles(), f(ARCH_GOLDEN, '{nope')]).status).toBe('FAIL');
  });
  it('reads the golden file from the file list', () => {
    expect(checkArchComponents([...archFiles(), f(ARCH_GOLDEN, JSON.stringify(archGolden))]).status).toBe('PASS');
  });
  it('the golden file has an authority note and no secret-shaped strings', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const g = loadFiles(root, [ARCH_GOLDEN]);
    expect(JSON.parse(g[0].text)._note).toMatch(/architect/i);
    expect(checkNoSecrets(g).status).toBe('PASS');
  });
  it('the real repo is green', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const r = checkArchComponents(loadFiles(root, gitPaths(root)));
    expect(r.status, r.details).toBe('PASS');
  });
});

const dmGolden = {
  tables: ['categories', 'photos', 'app_config', 'keepalive'],
  columns: { categories: ['id', 'slug'], photos: ['id', 'album_id', 'bytes_total'] },
  appConfigDefaults: { quota_hard_bytes: 9500000000, max_files_per_batch: 200 },
  photoWriteFunctions: ['register_photo', 'delete_photos'],
  anonExecute: ['keepalive'],
  functions: {
    register_photo: { revokeFrom: ['public', 'anon'], grantTo: ['authenticated'] },
    delete_photos: { revokeFrom: ['public', 'anon'], grantTo: ['authenticated'] },
    keepalive: { revokeFrom: ['public'], grantTo: ['anon', 'authenticated'] },
    bump: { revokeFrom: ['public', 'anon', 'authenticated'], grantTo: [] },
  },
  requiredFiles: ['supabase/tests/lint.test.ts'],
};
const dmSql = `
-- comment: create table public.ghost (id int);
create table public.categories (id uuid primary key, slug text not null unique, constraint c1 check (char_length(slug) > 1));
create table public.photos (id uuid primary key, album_id uuid not null, bytes_total bigint not null);
create table public.app_config (id boolean primary key default true, quota_hard_bytes bigint not null default 9500000000,
  max_files_per_batch integer not null default 200);
create table public.keepalive (id boolean primary key default true);
alter table public.categories enable row level security;
alter table public.photos enable row level security;
alter table public.app_config enable row level security;
alter table public.keepalive enable row level security;
revoke all on table public.categories, public.photos, public.app_config, public.keepalive from anon, authenticated;
grant select, insert, update, delete on table public.categories to authenticated;
grant select on table public.photos to authenticated;
grant update (album_id) on table public.photos to authenticated;
grant select on table public.app_config to authenticated;
create function public.bump() returns trigger language plpgsql security definer as $$ begin return null; end $$;
revoke execute on function public.bump() from public, anon, authenticated;
create function public.register_photo(p_id uuid, p_album uuid) returns jsonb language plpgsql security definer as $$ begin return '{}'; end $$;
revoke execute on function public.register_photo(uuid, uuid) from public, anon;
grant execute on function public.register_photo(uuid, uuid) to authenticated;
create function public.delete_photos(p_ids uuid[]) returns jsonb language plpgsql security definer as $$ begin return '{}'; end $$;
revoke execute on function public.delete_photos(uuid[]) from public, anon;
grant execute on function public.delete_photos(uuid[]) to authenticated;
create function public.keepalive() returns jsonb language plpgsql security definer as $$ begin return '{}'; end $$;
revoke execute on function public.keepalive() from public;
grant execute on function public.keepalive() to anon, authenticated;
`;
const dmFiles = (sql = dmSql, extra = []) => [
  f('supabase/migrations/20261019100000_a.sql', sql),
  f('supabase/tests/lint.test.ts'),
  ...extra,
];
const dmRun = (sql, extra) => checkArchDataModel(dmFiles(sql, extra), { dataModel: dmGolden });
const edit = (from, to) => dmSql.replace(from, to);

describe('arch-data-model', () => {
  it('passes on a conforming schema (comments, constraints and function bodies do not confuse it)', () => {
    const r = dmRun();
    expect(r.status, r.details).toBe('PASS');
  });
  it('fails on an unknown table and names it', () => {
    const r = dmRun(`${dmSql}\ncreate table public.page_texts (id int);\nalter table public.page_texts enable row level security;`);
    expect(r.status).toBe('FAIL');
    expect(r.details).toContain('page_texts');
  });
  it('fails on a missing golden table', () => {
    const r = dmRun(edit(/create table public\.keepalive[^;]*;/.exec(dmSql)[0], ''));
    expect(r.status).toBe('FAIL');
    expect(r.details).toContain('keepalive');
  });
  it('fails on a table without row level security and names it', () => {
    const r = dmRun(edit('alter table public.photos enable row level security;', ''));
    expect(r.status).toBe('FAIL');
    expect(r.details).toContain('table photos has no row level security');
  });
  it('fails on a table without the initial revoke and names it', () => {
    const r = dmRun(edit('public.app_config, public.keepalive from anon', 'public.app_config from anon'));
    expect(r.status).toBe('FAIL');
    expect(r.details).toContain('table keepalive has no initial revoke');
  });
  it('fails when a revoke covers only one of the roles', () => {
    const r = dmRun(edit('public.keepalive from anon, authenticated', 'public.keepalive from anon'));
    expect(r.status).toBe('FAIL');
    expect(r.details).toContain('no initial revoke');
  });
  it('fails when a table is granted before its revoke', () => {
    const r = dmRun(`${dmSql.replace('revoke all on table public.categories, public.photos, public.app_config, public.keepalive from anon, authenticated;', '')}\nrevoke all on table public.categories, public.photos, public.app_config, public.keepalive from anon, authenticated;`);
    expect(r.status).toBe('FAIL');
    expect(r.details).toContain('before its revoke');
  });
  it('fails on a table grant to anon and names the table', () => {
    const r = dmRun(`${dmSql}\ngrant select on table public.categories to anon;`);
    expect(r.status).toBe('FAIL');
    expect(r.details).toContain('table categories is granted to anon');
  });
  it('fails on default privileges for anon', () => {
    expect(dmRun(`${dmSql}\nalter default privileges in schema public grant select on tables to anon;`).status).toBe('FAIL');
  });
  it('allows only keepalive() to be executable by anon', () => {
    const r = dmRun(edit('grant execute on function public.delete_photos(uuid[]) to authenticated;', 'grant execute on function public.delete_photos(uuid[]) to authenticated, anon;'));
    expect(r.status).toBe('FAIL');
    expect(r.details).toContain('function delete_photos is executable by anon');
  });
  it('fails on direct insert or delete on photos for authenticated', () => {
    expect(dmRun(`${dmSql}\ngrant insert on table public.photos to authenticated;`).details).toContain('table photos');
    expect(dmRun(`${dmSql}\ngrant delete on table public.photos to authenticated;`).details).toContain('delete directly');
    expect(dmRun(`${dmSql}\ngrant all on table public.photos to authenticated;`).status).toBe('FAIL');
    expect(dmRun(`${dmSql}\ngrant insert (album_id) on table public.photos to authenticated;`).status).toBe('FAIL');
    expect(dmRun(`${dmSql}\ncreate policy p on public.photos for delete to authenticated using (true);`).details).toContain('table photos');
  });
  it('fails when a MASTERPLAN column is missing and names table and column', () => {
    const r = dmRun(edit('album_id uuid not null, ', ''));
    expect(r.status).toBe('FAIL');
    expect(r.details).toContain('table photos lacks column album_id');
  });
  it('fails when an app_config default changed, also through alter table', () => {
    const r = dmRun(edit('default 9500000000', 'default 9900000000'));
    expect(r.status).toBe('FAIL');
    expect(r.details).toContain('app_config default quota_hard_bytes');
    expect(dmRun(`${dmSql}\nalter table public.app_config alter column max_files_per_batch set default 500;`).status).toBe('FAIL');
  });
  it('fails when register_photo is missing and names it', () => {
    const r = dmRun(edit(/create function public\.register_photo[^\n]*\n[^\n]*\n[^\n]*\n/.exec(dmSql)[0], ''));
    expect(r.status).toBe('FAIL');
    expect(r.details).toContain('function register_photo missing');
  });
  it('fails on function privilege drift and unknown functions', () => {
    expect(dmRun(edit('revoke execute on function public.register_photo(uuid, uuid) from public, anon;', '')).details).toContain('register_photo is not revoked');
    expect(dmRun(`${dmSql}\ncreate function public.sneaky() returns int language sql as $$ select 1 $$;`).details).toContain('function sneaky is not in the golden set');
    expect(dmRun(edit('returns jsonb language plpgsql security definer as $$ begin return \'{}\'; end $$;\nrevoke execute on function public.register', 'returns jsonb language plpgsql as $$ begin return \'{}\'; end $$;\nrevoke execute on function public.register')).details).toContain('register_photo is not security definer');
  });
  it('fails when a required behavioural test file is missing', () => {
    const r = checkArchDataModel([f('supabase/migrations/20261019100000_a.sql', dmSql)], { dataModel: dmGolden });
    expect(r.status).toBe('FAIL');
    expect(r.details).toContain('supabase/tests/lint.test.ts missing');
  });
  it('fails without migrations, without a dataModel section, and with a missing or broken golden file', () => {
    expect(checkArchDataModel([f('supabase/tests/lint.test.ts')], { dataModel: dmGolden }).status).toBe('FAIL');
    expect(checkArchDataModel(dmFiles(), {}).status).toBe('FAIL');
    expect(checkArchDataModel(dmFiles()).status).toBe('FAIL');
    expect(checkArchDataModel(dmFiles(dmSql, [f(ARCH_GOLDEN, '{nope')])).status).toBe('FAIL');
    expect(checkArchDataModel(dmFiles(dmSql, [f(ARCH_GOLDEN, JSON.stringify({ dataModel: dmGolden }))])).status).toBe('PASS');
  });
  it('the golden file lists the MASTERPLAN tables', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const g = JSON.parse(loadFiles(root, [ARCH_GOLDEN])[0].text);
    expect([...g.dataModel.tables].sort()).toEqual(['admin_emails', 'albums', 'app_config', 'categories', 'change_log', 'keepalive', 'photos', 'publish_log', 'site_settings', 'site_state', 'upload_reservations', 'url_history']);
  });
  it('the real repo is green', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const r = checkArchDataModel(loadFiles(root, gitPaths(root)));
    expect(r.status, r.details).toBe('PASS');
  });
});

describe('registry and runner', () => {
  const inputs = {
    files: [
      ...archFiles(),
      f(
        ARCH_GOLDEN,
        JSON.stringify({
          ...archGolden,
          dataModel: dmGolden,
          api: apiGolden,
          storageKeys: { file: 'scripts/a.mjs', testFile: 'scripts/a.mjs', tiersFile: 'scripts/b.mjs', webpTiers: [1], snippets: [] },
          hosting: {},
          requiredSuites: [{ name: 'x', globs: ['scripts/a.mjs'] }],
        }),
      ),
      f('scripts/b.mjs', 'const WEBP_TIER_VALUES = [1];'),
      ...apiFiles({ 'apps/api/wrangler.toml': apiDefaults['apps/api/wrangler.toml'] }),
      f('.env.example', Object.keys(ENV_DOCS_ONLY).map((n) => `# docs-only: test\n# ${n}=\n`).join('') + '# worker url\nSUPABASE_URL=\n# worker secret\n# R2_SECRET_ACCESS_KEY=\n'),
      f('supabase/migrations/20261019100000_a.sql', dmSql),
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
  it('has no pending check left; docs-complete runs for real and fails on the synthetic input', () => {
    const rows = runChecks(inputs).rows;
    expect(rows.filter((r) => r.status === 'PENDING')).toEqual([]);
    expect(rows.find((r) => r.name === 'docs-complete').status).toBe('FAIL');
  });
  it('exits 0 normally and with --strict once docs-complete is left out of the synthetic input', () => {
    const checks = CHECKS.filter((c) => c.name !== 'docs-complete');
    expect(runChecks(inputs, { checks }).exitCode).toBe(0);
    expect(runChecks(inputs, { checks, strict: true }).exitCode).toBe(0);
  });
  it('--strict counts a PENDING check as failed', () => {
    const checks = [{ name: 'x', input: 'files', run: () => ({ status: 'PENDING', details: 'owned by WP-9' }) }];
    expect(runChecks(inputs, { checks }).exitCode).toBe(0);
    expect(runChecks(inputs, { checks, strict: true }).exitCode).toBe(1);
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
