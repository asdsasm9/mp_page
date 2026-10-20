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
      'handle only',
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
});
