/** docs/MAINTENANCE.md must stay one page: a full attention table, a short quarterly list, verified links. */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { headingAnchors } from './gates-docs.mjs';

const root = `${import.meta.dirname}/..`;
const docPath = `${root}/docs/MAINTENANCE.md`;
const doc = readFileSync(docPath, 'utf8');
const lines = doc.split('\n');

const section = (title: string): string[] => {
  const start = lines.findIndex((l) => l.trim() === `## ${title}`);
  expect(start, `heading ${title}`).toBeGreaterThanOrEqual(0);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith('## '));
  return end === -1 ? rest : rest.slice(0, end);
};

describe('docs/MAINTENANCE.md', () => {
  it('stays about one page', () => {
    expect(lines.length).toBeLessThanOrEqual(90);
  });

  it('has an attention table with at least 9 rows of five non-empty cells', () => {
    const rows = section('What can need attention').filter((l) => l.startsWith('|'));
    expect(rows[0]).toMatch(/^\| Trigger \| Symptom \| What to do \| Who \| Time \|$/);
    const body = rows.slice(2);
    expect(body.length).toBeGreaterThanOrEqual(9);
    for (const row of body) {
      const cells = row.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim());
      expect(cells, row).toHaveLength(5);
      for (const cell of cells) expect(cell, row).not.toBe('');
    }
  });

  it('covers the required triggers', () => {
    const table = section('What can need attention').join('\n');
    for (const word of ['Domain', 'pauses', 'keepalive', '8 GB', 'build fails', 'stuck', 'password', 'Dependency', 'policy change', 'Backup', 'Search Console']) {
      expect(table, word).toContain(word);
    }
  });

  it('has a quarterly checklist of at most 6 items', () => {
    const items = section('Quarterly checklist (about 20 minutes)').filter((l) => /^\d+\. /.test(l));
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items.length).toBeLessThanOrEqual(6);
  });

  it('states what is deliberately not monitored and its cost', () => {
    const text = section('Deliberately not monitored').join(' ');
    expect(text).toMatch(/No uptime pinger/);
    expect(text).toMatch(/The cost:/);
  });

  it('relative links resolve to files and anchors', () => {
    const links = [...doc.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]!).filter((l) => !/^(https?:|#)/.test(l));
    expect(links.length).toBeGreaterThanOrEqual(8);
    for (const link of links) {
      const [file, anchor] = link.split('#') as [string, string | undefined];
      const target = resolve(dirname(docPath), file);
      expect(existsSync(target), link).toBe(true);
      if (anchor !== undefined) {
        const slugs = [...headingAnchors(readFileSync(target, 'utf8'))];
        expect(slugs, link).toContain(anchor);
      }
    }
  });

  it('every TO VERIFY sits within 2 lines of a link to VERIFY.md', () => {
    const marks = lines.map((l, i) => (l.includes('TO VERIFY') ? i : -1)).filter((i) => i >= 0);
    expect(marks.length).toBeGreaterThanOrEqual(5);
    for (const i of marks) {
      const near = lines.slice(Math.max(0, i - 2), i + 3).join('\n');
      expect(near, `line ${i + 1}`).toMatch(/\]\(VERIFY\.md\)/);
    }
  });

  it('linked VERIFY rows exist', () => {
    const verify = readFileSync(`${root}/docs/VERIFY.md`, 'utf8');
    for (const [, n] of doc.matchAll(/\[row (\d+)\]\(VERIFY\.md\)/g)) {
      expect(verify, `row ${n}`).toMatch(new RegExp(`^\\| ${n} \\| `, 'm'));
    }
  });

  it('contains no secret-shaped strings', () => {
    expect(doc).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}|sk_[A-Za-z0-9]{10,}|https:\/\/[a-z0-9]{20,}\./);
  });
});
