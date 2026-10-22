import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { apiDefaults, apiFiles, apiGolden } from './api-surface.fixtures.mjs';
import { ARCH_GOLDEN, checkArchApiSurface, gitPaths, loadFiles } from './gates.mjs';
import * as arch from './gates-arch.mjs';

const run = (over, golden = apiGolden) => checkArchApiSurface(apiFiles(over), { api: golden });
const expectFail = (r, text) => {
  expect(r.status).toBe('FAIL');
  expect(r.details).toContain(text);
};

describe('arch-api-surface', () => {
  it('is re-exported from gates.mjs and lives in gates-arch.mjs', () => {
    expect(arch.checkArchApiSurface).toBe(checkArchApiSurface);
  });
  it('passes on a conforming surface', () => expect(run().status).toBe('PASS'));

  it('fails on an extra route in the table', () => {
    const t = apiDefaults['apps/api/src/default-routes.ts'].replace("  '/publish'", "  '/admin/debug': () => x,\n  '/publish'");
    expectFail(run({ 'apps/api/src/default-routes.ts': t }), 'route /admin/debug is not in the golden file');
  });
  it('fails on a missing route', () => {
    const t = apiDefaults['apps/api/src/default-routes.ts'].replace(/^ {2}'\/storage'.*\n/m, '');
    expectFail(run({ 'apps/api/src/default-routes.ts': t }), 'route /storage missing');
  });
  it('fails when /health is gone from index.ts', () => {
    expectFail(run({ 'apps/api/src/index.ts': 'const x = 1;\n' }), 'no pathname route');
  });
  it('ignores a commented-out route', () => {
    const t = apiDefaults['apps/api/src/default-routes.ts'].replace("  '/publish'", "  // '/old': () => x,\n  '/publish'");
    expect(run({ 'apps/api/src/default-routes.ts': t }).status).toBe('PASS');
  });

  it('fails on a [vars] value', () => {
    const toml = `${apiDefaults['apps/api/wrangler.toml']}[vars]\nSUPABASE_URL = "https://x.example"\n`;
    expectFail(run({ 'apps/api/wrangler.toml': toml }), '[vars] sets SUPABASE_URL');
  });
  it('fails on a second cron', () => {
    const toml = apiDefaults['apps/api/wrangler.toml'].replace('["17 3 * * *"]', '["17 3 * * *", "5 4 * * *"]');
    expectFail(run({ 'apps/api/wrangler.toml': toml }), '2 cron schedule(s)');
  });
  it('fails without a cron', () => {
    const toml = apiDefaults['apps/api/wrangler.toml'].replace('crons = ["17 3 * * *"]\n', '');
    expectFail(run({ 'apps/api/wrangler.toml': toml }), '0 cron schedule(s)');
  });
  it('fails on a missing PHOTOS binding', () => {
    const toml = apiDefaults['apps/api/wrangler.toml'].replace('binding = "PHOTOS"', 'binding = "OTHER"');
    const r = run({ 'apps/api/wrangler.toml': toml });
    expectFail(r, 'R2 binding PHOTOS missing');
    expect(r.details).toContain('R2 binding OTHER is not in the golden file');
  });
  it('fails on a second (backup) bucket binding', () => {
    const toml = `${apiDefaults['apps/api/wrangler.toml']}[[r2_buckets]]\nbinding = "BACKUP"\nbucket_name = "b"\n`;
    expectFail(run({ 'apps/api/wrangler.toml': toml }), 'R2 binding BACKUP is not in the golden file');
  });
  it('fails on routes in wrangler.toml and on other bindings', () => {
    expectFail(run({ 'apps/api/wrangler.toml': `routes = [{ pattern = "a.example/*" }]\n${apiDefaults['apps/api/wrangler.toml']}` }), 'top-level routes');
    expectFail(run({ 'apps/api/wrangler.toml': `${apiDefaults['apps/api/wrangler.toml']}[[routes]]\npattern = "a.example/*"\n` }), 'declares [[routes]]');
    expectFail(run({ 'apps/api/wrangler.toml': `${apiDefaults['apps/api/wrangler.toml']}[[kv_namespaces]]\nbinding = "K"\n` }), 'kv_namespaces');
  });
  it('ignores comments in wrangler.toml', () => {
    const toml = `# [vars]\n# crons = ["a", "b"]\n${apiDefaults['apps/api/wrangler.toml']}`;
    expect(run({ 'apps/api/wrangler.toml': toml }).status).toBe('PASS');
  });

  it('fails on an unlisted secret in env.ts', () => {
    const env = `${apiDefaults['apps/api/src/env.ts']}const c = req('NEW_SECRET_TOKEN');\n`;
    expectFail(run({ 'apps/api/src/env.ts': env }), 'env.ts reads NEW_SECRET_TOKEN');
  });
  it('fails when env.ts stops reading a golden secret', () => {
    expectFail(run({ 'apps/api/src/env.ts': "const a = req('SUPABASE_URL');\n" }), 'no longer reads golden name R2_SECRET_ACCESS_KEY');
  });

  it('fails when API.md lacks a route heading', () => {
    expectFail(run({ 'docs/API.md': '# API\n## GET /health\n## GET /storage\n## POST /uploads/reserve\n' }), 'no heading for /publish');
  });
  it('does not accept a prose mention instead of a heading', () => {
    expectFail(run({ 'docs/API.md': '# API\n## GET /health\n## GET /storage\n## POST /uploads/reserve\nsee /publish\n' }), 'no heading for /publish');
  });

  it('fails when a file or the golden api section is missing', () => {
    expectFail(run({ 'apps/api/wrangler.toml': null }), 'wrangler.toml missing');
    expectFail(run({ 'apps/api/src/env.ts': null }), 'env.ts missing');
    expectFail(run({ 'docs/API.md': null }), 'API.md missing');
    expect(checkArchApiSurface(apiFiles(), {}).status).toBe('FAIL');
    expect(checkArchApiSurface(apiFiles()).status).toBe('FAIL');
    expect(checkArchApiSurface([...apiFiles(), { path: ARCH_GOLDEN, text: '{nope' }]).status).toBe('FAIL');
  });

  it('the golden api section lists the planned surface', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const g = JSON.parse(loadFiles(root, [ARCH_GOLDEN])[0].text);
    expect([...g.api.routes].sort()).toEqual(['/health', '/photos/delete', '/publish', '/storage', '/storage/reconcile', '/uploads/commit', '/uploads/reserve']);
    expect([...g.api.bindings].sort()).toEqual(['PHOTOS']);
    expect(g.api.cronCount).toBe(1);
    expect([...g.api.secrets].sort()).toEqual(['PAGES_DEPLOY_HOOK_URL', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']);
  });
  it('the real repo is green', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const r = checkArchApiSurface(loadFiles(root, gitPaths(root)));
    expect(r.status, r.details).toBe('PASS');
  });
});
