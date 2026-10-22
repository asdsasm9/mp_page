/**
 * docs/ADMIN.md maps the 21 goals of ADMIN-UX section 9 to named tests. This keeps the map honest: every row points
 * at a file that exists and a `-t` filter that matches a test title in it, and all 21 goals appear.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = `${import.meta.dirname}/../../../..`;
const doc = readFileSync(`${root}/docs/ADMIN.md`, 'utf8');

const section = doc.split('## The 21 goals and the tests that prove them')[1]!.split('\n## ')[0]!;
const rows = [...section.matchAll(/^\| (\d+) \| .*? \| `([^`]+)` \| `([^`]+)` \|$/gm)].map((m) => ({
  goal: Number(m[1]),
  file: m[2]!,
  filter: m[3]!,
}));

describe('docs/ADMIN.md goal map', () => {
  it('covers goals 1 to 21', () => {
    expect([...new Set(rows.map((r) => r.goal))].sort((a, b) => a - b)).toEqual(Array.from({ length: 21 }, (_, i) => i + 1));
  });

  it.each(rows.map((r) => [`${r.goal}: ${r.file} -t "${r.filter}"`, r] as const))('%s', (_name, row) => {
    const path = `${import.meta.dirname}/../${row.file}`;
    expect(existsSync(path), `${row.file} exists`).toBe(true);
    const titles = [...readFileSync(path, 'utf8').matchAll(/\b(?:it|describe)(?:\.each\([^)]*\))?\(\s*(['"`])([\s\S]*?)\1/g)].map((m) => m[2]!);
    expect(titles.some((t) => t.includes(row.filter)), `a test title contains "${row.filter}"`).toBe(true);
  });

  it('lists the deviations the backlog asked for', () => {
    const deviations = doc.split('## Deviations from docs/ADMIN-UX.md and the plan')[1]!.split('\n## ')[0]!.toLowerCase();
    for (const word of [
      'inline buttons',
      'reordering is drag only',
      'two album badges',
      'one request per album',
      'no heic library',
      'lost on reload',
      'per session',
      'pending-change wording',
    ]) {
      expect(deviations, word).toContain(word);
    }
  });

  it('lists the deviations added by WP5-29 to WP5-31', () => {
    const deviations = doc.split('## Deviations from docs/ADMIN-UX.md and the plan')[1]!.split('\n## ')[0]!.toLowerCase();
    for (const word of ['jitless', 'connect-src', 'known evasions']) expect(deviations, word).toContain(word);
  });

  it('names every route of App.tsx', () => {
    const app = readFileSync(`${import.meta.dirname}/../App.tsx`, 'utf8');
    const paths = [...app.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]!);
    expect(paths.length).toBeGreaterThanOrEqual(9);
    for (const p of paths) expect(doc, p).toContain(`\`${p}\``);
  });

  it('names every admin env variable, here and in .env.example', () => {
    const env = readFileSync(`${import.meta.dirname}/../env.ts`, 'utf8');
    const names = [...new Set(env.match(/VITE_[A-Z0-9_]+/g) ?? [])];
    expect(names).toContain('VITE_SUPABASE_ANON_KEY');
    const example = readFileSync(`${root}/.env.example`, 'utf8');
    for (const n of [...names, 'PUBLIC_ADMIN_ORIGIN']) {
      expect(doc, n).toContain(n);
      expect(example, n).toMatch(new RegExp(`^${n}=`, 'm'));
    }
  });

  it('documents the deploy steps', () => {
    for (const s of ['/prihlaseni', 'PUBLIC_ADMIN_ORIGIN', 'R2 bucket CORS', 'ALLOWED_ORIGINS', 'admin_emails','sign-ups off', '_redirects']) {
      expect(doc, s).toContain(s);
    }
  });

  it('VERIFY.md has an admin row with owner and steps for each unverified live item', () => {
    const verify = readFileSync(`${root}/docs/VERIFY.md`, 'utf8');
    for (const id of [25, 26, 27, 28, 29, 30, 31, 32]) {
      const row = verify.split('\n').find((l) => l.startsWith(`| ${id} | `));
      expect(row, `row ${id}`).toBeDefined();
      const cells = row!.split(/(?<!\\)\|/).map((c) => c.trim());
      expect(cells[4], `row ${id} how to verify`).not.toBe('');
      expect(cells[5], `row ${id} owner`).toMatch(/human/);
      expect(cells[6], `row ${id} status`).toBe('HUMAN');
    }
  });
});
