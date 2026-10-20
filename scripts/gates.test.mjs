import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CHECKS,
  FAKE_WORLD_MARKER,
  QUOTA_GUARD_FILE,
  QUOTA_GUARD_TITLES,
  WRANGLER_TOML,
  checkAdminDistExternalHosts,
  checkAdminDistNoFakeMarker,
  checkAdminDistNoKeyStrings,
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
