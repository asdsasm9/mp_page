import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ROUTES } from '../src/default-routes';

const root = (p: string) => join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', p);
const read = (p: string) => readFileSync(root(p), 'utf8');

const api = read('docs/API.md');
const deploy = read('docs/DEPLOY-API.md');
const envSource = read('apps/api/src/env.ts');

/** Methods per path, taken from the router test table's source of truth: the routes themselves. */
const METHODS: Record<string, string> = {
  '/health': 'GET',
  '/storage': 'GET',
};
const methodOf = (path: string): string => METHODS[path] ?? 'POST';

describe('docs/API.md', () => {
  const headings = new Set([...api.matchAll(/^## (GET|POST|PUT|DELETE) (\S+)\s*$/gm)].map((m) => `${m[1]} ${m[2]}`));

  it('has a "## METHOD /path" heading for every route in the table plus /health', () => {
    for (const path of [...Object.keys(DEFAULT_ROUTES), '/health']) {
      expect(headings, path).toContain(`${methodOf(path)} ${path}`);
    }
  });

  it('documents no route that does not exist', () => {
    const real = new Set([...Object.keys(DEFAULT_ROUTES), '/health']);
    for (const h of headings) expect(real, h).toContain(h.split(' ')[1]);
  });

  it('declares the stated method for each route', () => {
    for (const [path, route] of Object.entries(DEFAULT_ROUTES)) {
      expect(route({} as never).methods, path).toEqual([methodOf(path)]);
    }
  });
});

describe('docs/DEPLOY-API.md', () => {
  const envNames = [...envSource.matchAll(/req\('([A-Z0-9_]+)'/g)].map((m) => m[1]!);

  it('reads nine configuration names from env.ts, none for a backup bucket', () => {
    expect(envNames).toHaveLength(9);
    expect(envNames).not.toContain('R2_BACKUP_BUCKET');
  });

  it('has an exact `wrangler secret put` line for every name in env.ts, and no other', () => {
    const put = [...deploy.matchAll(/^npx wrangler secret put ([A-Z0-9_]+)$/gm)].map((m) => m[1]!);
    expect([...put].sort()).toEqual([...envNames].sort());
  });

  it('names equal the Worker names in .env.example (names only file)', () => {
    const example = read('.env.example');
    const names = [...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]!);
    for (const n of envNames) expect(names, n).toContain(n);
  });

  it('contains R2 CORS JSON that parses and allows PUT for the admin origins', () => {
    const section = deploy.split(/^## 6\./m)[1]!.split(/^## 7\./m)[0]!;
    const block = /```json\n([\s\S]*?)```/.exec(section)![1]!;
    const rules = JSON.parse(block) as Array<{ AllowedMethods: string[]; AllowedOrigins: string[]; AllowedHeaders: string[] }>;
    expect(rules[0]!.AllowedMethods).toEqual(['PUT']);
    expect(rules[0]!.AllowedOrigins.length).toBeGreaterThan(0);
    expect(rules[0]!.AllowedHeaders).toEqual(expect.arrayContaining(['content-type', 'cache-control']));
    expect(rules[0]!.AllowedOrigins.every((o) => !o.includes('*'))).toBe(true);
  });

  it('names the bindings and the cron from wrangler.toml', () => {
    const toml = read('apps/api/wrangler.toml');
    expect(toml).toContain('PHOTOS');
    expect(deploy).toContain('PHOTOS');
    // T-222: there is no backup bucket or BACKUP binding any more.
    for (const b of ['`BACKUP`', 'mullnyphotos-backup', 'R2_BACKUP_BUCKET']) {
      expect(toml).not.toContain(b.replaceAll('`', ''));
      expect(deploy).not.toContain(b);
    }
    expect(deploy).toContain('17 3 * * *');
    expect(toml).toContain('17 3 * * *');
  });
});
