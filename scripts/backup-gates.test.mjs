import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CHECKS,
  checkBackupNoCredentials,
  checkBackupNoR2,
  checkBackupNoServiceKey,
  checkBackupReadOnly,
  checkNoSecrets,
  checkRestorePlanOffline,
  collect,
  runChecks,
} from './gates.mjs';

const f = (path, text = '') => ({ path, text });
// Fake secrets and forbidden words are assembled at runtime so this file contains no secret-shaped literal.
const role = ['service', 'role'].join('_');
const sdk = ['aws4', 'fetch'].join('');
const r2Host = ['r2', 'cloudflarestorage', 'com'].join('.');
const awsSdk = ['@aws', 'sdk'].join('-');
const jwt =['eyJ', 'hbGciOiJIUzI1NiJ9', '.', 'eyJzdWIiOiJ4eHh4eHgifQ', '.', 'c2lnbmF0dXJl'].join('');
const post = `'${['PO', 'ST'].join('')}'`;
const patch = `'${['PAT', 'CH'].join('')}'`;
const signIn = `await auth('token?grant_type=password', {\n  method: ${post},\n  body: '{}',\n});\nawait get('x', { method: 'GET' });\n`;
const SRC = ['scripts/backup.ts', 'scripts/backup/run.ts', 'scripts/restore-plan.ts', 'scripts/restore-plan/sql.ts'];

describe('backup-no-service-key', () => {
  it('passes clean sources', () => expect(checkBackupNoServiceKey(SRC.map((p) => f(p, 'const a = 1'))).status).toBe('PASS'));
  for (const p of SRC) {
    it(`fails on a service key mention in ${p}`, () => {
      const r = checkBackupNoServiceKey([f(p, `// uses ${role}`)]);
      expect(r.status).toBe('FAIL');
      expect(r.details).toContain(p);
    });
  }
  it('fails on a service key name', () => expect(checkBackupNoServiceKey([f('scripts/backup/a.ts', 'serviceKey')]).status).toBe('FAIL'));
  it('ignores test files and unrelated scripts', () =>
    expect(checkBackupNoServiceKey([f('scripts/backup/a.test.ts', role), f('scripts/other.ts', role)]).status).toBe('PASS'));
});

describe('backup-no-r2', () => {
  it('passes clean sources', () => expect(checkBackupNoR2([f('scripts/backup/masters.ts', 'fetch(url)')]).status).toBe('PASS'));
  it('fails on the S3 signing library import', () =>
    expect(checkBackupNoR2([f('scripts/backup/masters.ts', `import { X } from '${sdk}';`)]).status).toBe('FAIL'));
  it('fails on an R2 host', () =>
    expect(checkBackupNoR2([f('scripts/restore-plan/cli.ts', `https://a.${r2Host}/x`)]).status).toBe('FAIL'));
  it('fails on an AWS SDK import', () =>
    expect(checkBackupNoR2([f('scripts/backup.ts', `import '${awsSdk}/client-s3'`)]).status).toBe('FAIL'));
  it('ignores test files', () => expect(checkBackupNoR2([f('scripts/backup/a.test.ts', sdk)]).status).toBe('PASS'));
});

describe('backup-read-only', () => {
  it('passes GET-only sources', () => expect(checkBackupReadOnly([f('scripts/backup/masters.ts', "method: 'GET'")]).status).toBe('PASS'));
  it('allows the single sign-in POST in catalog.ts', () =>
    expect(checkBackupReadOnly([f('scripts/backup/catalog.ts', signIn)]).status).toBe('PASS'));
  it('fails on a PATCH literal', () => {
    const r = checkBackupReadOnly([f('scripts/backup/run.ts', `method: ${patch}`)]);
    expect(r.status).toBe('FAIL');
    expect(r.details).toContain('scripts/backup/run.ts');
  });
  it('fails on a second POST in catalog.ts', () =>
    expect(checkBackupReadOnly([f('scripts/backup/catalog.ts', `${signIn}\nfetch(u, { method: ${post} });`)]).status).toBe('FAIL'));
  it('fails on a POST to another path in catalog.ts', () =>
    expect(checkBackupReadOnly([f('scripts/backup/catalog.ts', `await auth('signup', { method: ${post} });`)]).status).toBe('FAIL'));
  it('fails on a POST in another backup file even with the sign-in text', () =>
    expect(checkBackupReadOnly([f('scripts/backup/masters.ts', signIn)]).status).toBe('FAIL'));
  it('fails on PUT and DELETE in restore-plan', () => {
    expect(checkBackupReadOnly([f('scripts/restore-plan/cli.ts', `x(${"'PUT'"})`)]).status).toBe('FAIL');
    expect(checkBackupReadOnly([f('scripts/restore-plan.ts', `x(${'"DELETE"'})`)]).status).toBe('FAIL');
  });
  it('ignores test files', () => expect(checkBackupReadOnly([f('scripts/backup/a.test.ts', patch)]).status).toBe('PASS'));
});

describe('backup-no-credentials', () => {
  it('passes clean sources', () => expect(checkBackupNoCredentials([f('scripts/backup/a.ts', 'const key = process.env.X')]).status).toBe('PASS'));
  it('fails on a JWT', () => expect(checkBackupNoCredentials([f('scripts/backup/a.ts', `const t = "${jwt}"`)]).status).toBe('FAIL'));
  it('fails on a key-shaped literal', () =>
    expect(checkBackupNoCredentials([f('scripts/restore-plan/a.ts', `const apiKey = "${'a1'.repeat(20)}"`)]).status).toBe('FAIL'));
  it('fails on a password literal', () =>
    expect(checkBackupNoCredentials([f('scripts/backup.ts', `password: "${'Zx9'.repeat(12)}"`)]).status).toBe('FAIL'));
  it('ignores test files here, but no-secrets still catches a secret in a test file', () => {
    const t = f('scripts/backup/a.test.ts', `const t = "${jwt}"`);
    expect(checkBackupNoCredentials([t]).status).toBe('PASS');
    expect(checkNoSecrets([t]).status).toBe('FAIL');
  });
});

describe('restore-plan-offline', () => {
  it('passes a pure emitter', () =>
    expect(checkRestorePlanOffline([f('scripts/restore-plan/sql.ts', "import { x } from '../../packages/shared/src';\nconst a = 1;")]).status).toBe('PASS'));
  // Raw scan, fail closed: comments count too, so restore-plan comments must avoid the banned words.
  it('fails on a comment that names a banned word', () => {
    expect(checkRestorePlanOffline([f('scripts/restore-plan/sql.ts', '// no child_process here\nconst a = 1;')]).status).toBe('FAIL');
    expect(checkRestorePlanOffline([f('scripts/restore-plan/sql.ts', '/* http */ const a = 1;')]).status).toBe('FAIL');
  });
  it('passes a comment worded without banned words', () =>
    expect(checkRestorePlanOffline([f('scripts/restore-plan/sql.ts', '// no network access, no process spawning\nconst a = 1;')]).status).toBe('PASS'));
  it('fails when a regex literal with // precedes fetch(', () =>
    expect(checkRestorePlanOffline([f('scripts/restore-plan/a.ts', 'x.replace(/^a:\\/\\//, 1); fetch(u);')]).status).toBe('FAIL'));
  it('fails when a regex literal with /* precedes fetch(', () =>
    expect(checkRestorePlanOffline([f('scripts/restore-plan/a.ts', 'x.split(/[/*]/); fetch(u);')]).status).toBe('FAIL'));
  it('fails when a regex literal holds a quote or backtick before fetch(', () => {
    expect(checkRestorePlanOffline([f('scripts/restore-plan/a.ts', "/'/; fetch(u);")]).status).toBe('FAIL');
    expect(checkRestorePlanOffline([f('scripts/restore-plan/a.ts', 'x.split(/`/); fetch(u);')]).status).toBe('FAIL');
  });
  it('still sees fetch( after a // inside a string', () =>
    expect(checkRestorePlanOffline([f('scripts/restore-plan/a.ts', 'const s = "a // b"; await fetch(u);')]).status).toBe('FAIL'));
  it('does not let "/*" and "*/" in strings hide the code between them', () =>
    expect(checkRestorePlanOffline([f('scripts/restore-plan/a.ts', 'const a = "/*";\nawait fetch(u);\nconst b = "*/";')]).status).toBe('FAIL'));
  it('still sees fetch( inside a template expression', () =>
    expect(checkRestorePlanOffline([f('scripts/restore-plan/a.ts', 'const a = `x ${await fetch(u)} // y`;')]).status).toBe('FAIL'));
  it('fails on fetch(', () => {
    const r = checkRestorePlanOffline([f('scripts/restore-plan/cli.ts', 'await fetch(u);')]);
    expect(r.status).toBe('FAIL');
    expect(r.details).toContain('scripts/restore-plan/cli.ts');
  });
  it('fails on an http URL, also after a string slash pair', () =>
    expect(checkRestorePlanOffline([f('scripts/restore-plan.ts', "const u = 'https://example.org';")]).status).toBe('FAIL'));
  it('fails on XMLHttpRequest', () =>
    expect(checkRestorePlanOffline([f('scripts/restore-plan/a.ts', 'new XMLHttpRequest()')]).status).toBe('FAIL'));
  it('fails on child_process', () =>
    expect(checkRestorePlanOffline([f('scripts/restore-plan/a.ts', "import { exec } from 'node:child_process';")]).status).toBe('FAIL'));
  for (const mod of ['net', 'https', 'dgram', 'tls']) {
    it(`fails on a node:${mod} import`, () =>
      expect(checkRestorePlanOffline([f('scripts/restore-plan/a.ts', `import x from 'node:${mod}';`)]).status).toBe('FAIL'));
  }
  it('does not apply to backup sources or test files', () =>
    expect(checkRestorePlanOffline([f('scripts/backup/a.ts', 'fetch(u)'), f('scripts/restore-plan/a.test.ts', 'fetch(u)')]).status).toBe('PASS'));
});

describe('registry and real repo', () => {
  const names = CHECKS.map((c) => c.name);
  const five = ['backup-no-service-key', 'backup-no-r2', 'backup-read-only', 'backup-no-credentials', 'restore-plan-offline'];
  it('registers all five before docs-complete', () => {
    for (const n of five) expect(names.indexOf(n)).toBeGreaterThan(-1);
    for (const n of five) expect(names.indexOf(n)).toBeLessThan(names.indexOf('docs-complete'));
  });
  it('the real repo is green for the five gates and sees real sources', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const inputs = collect(root);
    const scanned = inputs.files.filter((x) => /^scripts\/(backup|restore-plan)(\.ts|\/)/.test(x.path) && !/\.test\./.test(x.path));
    expect(scanned.map((x) => x.path)).toEqual(expect.arrayContaining(['scripts/backup/catalog.ts', 'scripts/restore-plan/sql.ts']));
    const { rows } = runChecks(inputs, { checks: CHECKS.filter((c) => five.includes(c.name)) });
    for (const r of rows) expect(r, r.name).toMatchObject({ status: 'PASS' });
    expect(checkNoSecrets(inputs.files).status).toBe('PASS');
  });
});
