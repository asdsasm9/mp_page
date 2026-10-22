// Tests for arch-storage-keys, arch-hosting-files and arch-tests-present (WP8-6). Synthetic cases are the real repo
// files with one deliberate breakage (the golden file is the real one), plus a "real repo is green" test per gate.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CHECKS, gitPaths, loadFiles } from './gates.mjs';
import * as arch from './gates-arch.mjs';
import { globToRegExp } from './lib/gate-utils.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const real = loadFiles(root, gitPaths(root));

/** Real files with `path` replaced (string or fn) or removed (null). */
const mutate = (path, change) =>
  real.flatMap((x) => {
    if (x.path !== path) return [x];
    if (change === null) return [];
    return [{ path, text: typeof change === 'function' ? change(x.text) : change }];
  });
const without = (re) => real.filter((x) => !re.test(x.path));
const expectFail = (r, text) => {
  expect(r.status, r.details).toBe('FAIL');
  expect(r.details).toContain(text);
};

describe('arch-storage-keys', () => {
  const run = (files) => arch.checkArchStorageKeys(files);
  it('is registered in CHECKS', () => {
    expect(CHECKS.find((c) => c.name === 'arch-storage-keys')?.input).toBe('files');
  });
  it('passes on the real repo', () => {
    const r = run(real);
    expect(r.status, r.details).toBe('PASS');
  });
  it('fails when the master key template changes', () => {
    expectFail(run(mutate('packages/shared/src/keys.ts', (t) => t.replace('master.jpg`', 'original.jpg`'))), 'lost key template');
  });
  it('fails when the snapshot key changes', () => {
    expectFail(run(mutate('packages/shared/src/keys.ts', (t) => t.replace('catalog/published.json', 'catalog/live.json'))), 'SNAPSHOT_KEY');
  });
  it('does not accept a template that survives only in a comment', () => {
    const r = run(mutate('packages/shared/src/keys.ts', (t) => t.replace('`${photoPrefix(id)}og.jpg`', '`${photoPrefix(id)}x.jpg`').replace('/** Storage key scheme.', '// `${photoPrefix(id)}og.jpg`\n/** Storage key scheme.')));
    expectFail(r, 'og.jpg');
  });
  it('fails when the webp tier list changes', () => {
    expectFail(run(mutate('packages/shared/src/variants.ts', (t) => t.replace('[480, 720, 960, 1600, 2400]', '[480, 720, 960, 1600]'))), 'webp tiers are');
  });
  it('fails when keys.test.ts or keys.ts is deleted', () => {
    expectFail(run(mutate('packages/shared/src/keys.test.ts', null)), 'keys.test.ts missing');
    expectFail(run(mutate('packages/shared/src/keys.ts', null)), 'keys.ts missing');
  });
  it('fails without the golden file or its section', () => {
    expect(run(mutate('scripts/architecture.golden.json', null)).status).toBe('FAIL');
    expectFail(arch.checkArchStorageKeys(real, {}), 'no storageKeys section');
  });
});

describe('arch-hosting-files', () => {
  const run = (files) => arch.checkArchHostingFiles(files);
  it('is registered in CHECKS', () => {
    expect(CHECKS.find((c) => c.name === 'arch-hosting-files')?.input).toBe('files');
  });
  it('passes on the real repo', () => {
    const r = run(real);
    expect(r.status, r.details).toBe('PASS');
  });
  it('fails when the web _headers generator is missing', () => {
    expectFail(run(mutate('apps/web/src/lib/headers.ts', null)), 'web _headers generator');
  });
  it('fails when the _headers generator loses the /_publish.json block', () => {
    expectFail(run(mutate('apps/web/src/lib/headers.ts', (t) => t.replace("block('/_publish.json'", "block('/other.json'"))), '/_publish.json');
  });
  it('fails when the _redirects or _publish.json generator or its test is missing', () => {
    expectFail(run(mutate('apps/web/src/lib/redirects.ts', null)), 'web _redirects generator');
    expectFail(run(mutate('apps/web/src/lib/publish-json.ts', null)), 'web _publish.json generator');
    expectFail(run(mutate('apps/web/src/lib/headers.test.ts', null)), 'test apps/web/src/lib/headers.test.ts missing');
  });
  it('fails when postbuild stops writing _publish.json', () => {
    expectFail(run(mutate('apps/web/scripts/postbuild.ts', (t) => t.replaceAll("'_publish.json'", "'p.json'"))), 'web postbuild');
  });
  it('fails when the admin index.html has no noindex', () => {
    expectFail(run(mutate('apps/admin/index.html', (t) => t.replace(/<meta name="robots"[^>]*>/, ''))), 'no noindex robots meta');
  });
  it('fails when the admin SPA fallback is missing or wrong', () => {
    expectFail(run(mutate('apps/admin/public/_redirects', null)), 'SPA fallback');
    expectFail(run(mutate('apps/admin/public/_redirects', '/old  /index.html  200\n')), 'no /* -> /index.html 200 rule');
  });
  it('fails when the admin headers lose the CSP or the noindex header', () => {
    expectFail(run(mutate('apps/admin/headers.ts', (t) => t.replaceAll('Content-Security-Policy', 'X-Csp'))), 'Content-Security-Policy');
    expectFail(run(mutate('apps/admin/headers.ts', null)), 'admin headers');
  });
  it('fails on github.io, gh-pages and Google tag references in hosted sources', () => {
    expectFail(run(mutate('apps/admin/index.html', (t) => `${t}\n<a href="https://x.github.io/a">x</a>`)), 'github');
    expectFail(run(mutate('apps/web/package.json', (t) => t.replace('{', '{ "homepage": "gh-pages",'))), 'gh-pages');
    expectFail(run(mutate('apps/web/src/components/Footer.astro', (t) => `${t}\n<script src="https://www.googletagmanager.com/gtag/js"></script>`)), 'googletagmanager');
  });
  it('ignores those words outside the hosted sources (tests, gate scripts)', () => {
    expect(run(mutate('apps/web/src/lib/jsonld.test.ts', (t) => `${t}\n// github.io gh-pages\n`)).status).toBe('PASS');
  });
  it('fails without the golden hosting section', () => {
    expectFail(arch.checkArchHostingFiles(real, {}), 'no hosting section');
  });
});

describe('arch-tests-present', () => {
  const run = (files) => arch.checkArchTestsPresent(files);
  it('is registered in CHECKS', () => {
    expect(CHECKS.find((c) => c.name === 'arch-tests-present')?.input).toBe('files');
  });
  it('passes on the real repo', () => {
    const r = run(real);
    expect(r.status, r.details).toBe('PASS');
  });
  it('fails when a required suite is deleted', () => {
    expectFail(run(mutate('packages/shared/src/variants.test.ts', null)), 'suite "variantPlan"');
    expectFail(run(mutate('packages/shared/src/snapshot.test.ts', null)), 'suite "snapshot schema"');
    expectFail(run(without(/^supabase\/tests\/(hardening|lint)\.test\.ts$/)), 'suite "RLS and grants"');
  });
  it('fails when all admin component tests are deleted but not when one remains', () => {
    expectFail(run(without(/^apps\/admin\/src\/(components|screens)\/[^/]+\.test\.tsx$/)), 'suite "admin components"');
    expect(run(without(/^apps\/admin\/src\/screens\/.*\.test\.tsx$/)).status).toBe('PASS');
  });
  it('fails when the migration suite no longer mentions 141 photos or 13 albums', () => {
    expectFail(run(mutate('scripts/migrate-legacy/resume.test.ts', (t) => t.replaceAll('141', 'many'))), 'mentions 141');
    expectFail(run(mutate('scripts/migrate-legacy/catalog.test.ts', (t) => t.replaceAll('13 albums', 'all albums'))), 'mentions 13 albums');
  });
  it('fails when an empty or missing suites list is given', () => {
    expectFail(arch.checkArchTestsPresent(real, { requiredSuites: [] }), 'empty');
    expectFail(arch.checkArchTestsPresent(real, {}), 'no requiredSuites section');
  });
  it('every golden suite matches a real file by itself', () => {
    const golden = JSON.parse(real.find((x) => x.path === 'scripts/architecture.golden.json').text);
    for (const s of golden.requiredSuites) {
      const res = s.globs.map(globToRegExp);
      expect(
        real.some((x) => res.some((re) => re.test(x.path))),
        s.name,
      ).toBe(true);
    }
  });
});

describe('globToRegExp', () => {
  it('handles *, ** and literal dots', () => {
    expect(globToRegExp('a/*.test.ts').test('a/b.test.ts')).toBe(true);
    expect(globToRegExp('a/*.test.ts').test('a/c/b.test.ts')).toBe(false);
    expect(globToRegExp('a/**').test('a/c/b.png')).toBe(true);
    expect(globToRegExp('a/**/x.ts').test('a/x.ts')).toBe(true);
    expect(globToRegExp('a/b.ts').test('a/bxts')).toBe(false);
  });
});
