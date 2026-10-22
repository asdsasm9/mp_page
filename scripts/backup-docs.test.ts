/** D-17: docs/BACKUP.md says plainly that there are no backups, and no backup tooling is left behind. */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = `${import.meta.dirname}/..`;
const docPath = `${root}/docs/BACKUP.md`;
const doc = readFileSync(docPath, 'utf8');

describe('docs/BACKUP.md', () => {
  it('states that there are no backups and what cannot be recovered', () => {
    expect(doc).toContain('Backups: there are none');
    expect(doc).toContain('cannot be recovered');
    expect(doc).toContain('catalog/published.json');
    expect(doc).toContain('### Situation 1: ');
  });

  it('names no removed tool or bucket as something to run or create', () => {
    expect(doc).not.toContain('npm run backup');
    expect(doc).not.toContain('npm run restore-plan');
    expect(doc).not.toMatch(/mullnyphotos-backup/);
  });

  it('relative links resolve to files', () => {
    const links = [...doc.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]!).filter((l) => !/^(https?:|#)/.test(l));
    expect(links.length).toBeGreaterThanOrEqual(3);
    for (const link of links) expect(existsSync(resolve(dirname(docPath), link.split('#')[0]!)), link).toBe(true);
  });

  it('the backup and restore tools are gone', () => {
    for (const p of ['scripts/backup.ts', 'scripts/backup', 'scripts/restore-plan.ts', 'scripts/restore-plan', 'packages/shared/src/backup.ts']) {
      expect(existsSync(`${root}/${p}`), p).toBe(false);
    }
    const pkg = JSON.parse(readFileSync(`${root}/package.json`, 'utf8')) as { scripts: Record<string, string> };
    expect(Object.keys(pkg.scripts)).not.toContain('backup');
    expect(Object.keys(pkg.scripts)).not.toContain('restore-plan');
  });
});
