/** docs/MIGRATION.md must name every flag and env variable of the script, list the defaults with owners, and not go stale. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = `${import.meta.dirname}/../..`;
const read = (p: string) => readFileSync(`${root}/${p}`, 'utf8');
const doc = read('docs/MIGRATION.md');

const flags = [...new Set([...read('scripts/migrate-legacy/args.ts').matchAll(/case '(--[a-z-]+)'/g)].map((m) => m[1]!))];
const usageEnv = read('scripts/migrate-legacy/args.ts').split('Environment (names only')[1]!.split('`;')[0]!;
const envNames = [...new Set(usageEnv.match(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g) ?? [])];

describe('docs/MIGRATION.md', () => {
  it('finds the flags and env names in the source (guards the extraction)', () => {
    expect(flags).toEqual(expect.arrayContaining(['--help', '--live', '--confirm-project', '--album', '--limit-bytes', '--repair', '--alt', '--allow-host']));
    expect(envNames).toEqual(
      expect.arrayContaining(['MIGRATE_ACCESS_TOKEN', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'API_BASE_URL', 'PUBLIC_IMG_BASE_URL']),
    );
  });

  it.each(flags)('documents flag %s', (flag) => {
    expect(doc).toContain(`\`${flag}`);
  });

  it.each(envNames)('documents env name %s', (name) => {
    expect(doc).toContain(`\`${name}\``);
  });

  it('has the required sections and facts', () => {
    for (const s of [
      '## Usage',
      '## Prerequisites',
      '## Verification checklist',
      '## Rollback',
      '## Live --repair limitation (D-11)',
      '## Defaults taken (D-10)',
      '## The redirect file',
      '--album lucka_filip',
      '/photos/delete',
      'H-5',
      '141 photos',
      '154 MB',
      '36 s',
      'CONFLICT',
    ]) {
      expect(doc, s).toContain(s);
    }
  });

  it('gives every default an owner', () => {
    const section = doc.split('## Defaults taken (D-10)')[1]!.split('\n## ')[0]!;
    const rows = section.split('\n').filter((l) => /^\| \d+ \|/.test(l));
    expect(rows.length).toBeGreaterThanOrEqual(6);
    for (const r of rows) {
      const cells = r.split('|').map((c) => c.trim());
      expect(cells[2], r).not.toBe('');
      expect(cells[3], `owner in: ${r}`).not.toBe('');
    }
  });

  it('has no stale "sort = n" in the data docs and mentions 10/20/30', () => {
    const cm = read('docs/CONTENT-MAPPING.md');
    const dm = read('docs/DATA-MODEL.md');
    expect(cm).not.toMatch(/`sort` = n\b/);
    expect(cm).toContain('10, 20, 30');
    expect(dm).toContain('10, 20, 30');
    expect(dm.toLowerCase()).toContain('re-encoded');
    expect(dm).toContain('UUIDv5');
  });

  it('VERIFY.md has human rows 33 to 36 with steps', () => {
    const verify = read('docs/VERIFY.md');
    for (const id of [33, 34, 35, 36]) {
      const row = verify.split('\n').find((l) => l.startsWith(`| ${id} | `));
      expect(row, `row ${id}`).toBeDefined();
      const cells = row!.split(/(?<!\\)\|/).map((c) => c.trim());
      expect(cells[4], `row ${id} how to verify`).not.toBe('');
      expect(cells[5]).toMatch(/human/);
      expect(cells[6]).toBe('HUMAN');
    }
  });

  it('does not claim exit 2 for a sign-in failure and uses the Czech button name', () => {
    expect(read('docs/VERIFY.md').split('\n').find((l) => l.startsWith('| 36 | '))).not.toMatch(/fails with exit 2/);
    expect(read('docs/VERIFY.md').split('\n').find((l) => l.startsWith('| 36 | '))).toContain('MIGRATE_ACCESS_TOKEN');
    expect(doc).toContain('Zveřejnit web');
    expect(doc).not.toContain('rows 33 to 36 below');
  });

  it('weak photo count and list equal what the dry-run flags on the real legacy files', async () => {
    const sharp = (await import('sharp')).default;
    const { discoverSources } = await import('./sources');
    const { isWeakSource } = await import('./planner');
    const weak: string[] = [];
    for (const a of discoverSources().albums) {
      for (const p of a.photos) {
        const m = await sharp(p.path).metadata();
        const swap = (m.orientation ?? 1) >= 5;
        const [w, h] = swap ? [m.height ?? 0, m.width ?? 0] : [m.width ?? 0, m.height ?? 0];
        if (isWeakSource(w, h)) weak.push(p.legacyKey);
      }
    }
    const section = doc.split('## Source quality: weak photos (T-264)')[1]!.split('\n## ')[0]!;
    expect(section).toContain(`Weak photos: ${weak.length} of 141`);
    expect(section).toContain(`weak photos ${weak.length} of 141`);
    const listed = [...section.matchAll(/`((?:weddings|portraits|couples)\/[a-z0-9_]+\/\d+\.jpg)`/g)].map((m) => m[1]!);
    expect(listed.sort()).toEqual([...weak].sort());
    expect(read('README.md').toLowerCase()).toContain('re-upload weak photos from originals');
    expect(read('README.md').toLowerCase()).toContain(`${weak.length} of 141`);
  });

  it('README points to it', () => {
    expect(read('README.md')).toContain('docs/MIGRATION.md');
  });
});
