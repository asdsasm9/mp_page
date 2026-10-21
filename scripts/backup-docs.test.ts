/** docs/BACKUP.md must cover every CLI flag, the three recovery situations and the coverage gap. */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { USAGE as BACKUP_USAGE } from './backup/cli';
import { USAGE as RESTORE_USAGE } from './restore-plan/cli';

const root = `${import.meta.dirname}/..`;
const docPath = `${root}/docs/BACKUP.md`;
const doc = readFileSync(docPath, 'utf8');
const flags = (usage: string): string[] => [...new Set(usage.match(/--[a-z][a-z-]*/g) ?? [])];

describe('docs/BACKUP.md', () => {
  it.each(flags(BACKUP_USAGE))('documents backup flag %s', (flag) => {
    expect(doc).toContain(`\`${flag}`);
  });

  it.each(flags(RESTORE_USAGE))('documents restore-plan flag %s', (flag) => {
    expect(doc).toContain(`\`${flag}`);
  });

  it('names the environment variables of the backup usage', () => {
    for (const name of BACKUP_USAGE.match(/\b[A-Z][A-Z_]{5,}\b/g) ?? []) expect(doc, name).toContain(name);
  });

  it.each(['### Situation 1: ', '### Situation 2: ', '### Situation 3: '])('has the heading %s', (h) => {
    expect(doc).toContain(`\n${h}`);
  });

  it('states the coverage gap and the rolling backups', () => {
    expect(doc).toContain('no automatic second copy');
    expect(doc).toContain('newest 20');
    expect(doc).toContain('Nothing described here was run against a live service');
  });

  it('relative links resolve to files', () => {
    const links = [...doc.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]!).filter((l) => !/^(https?:|#)/.test(l));
    expect(links.length).toBeGreaterThanOrEqual(5);
    for (const link of links) {
      const file = link.split('#')[0]!;
      expect(existsSync(resolve(dirname(docPath), file)), link).toBe(true);
    }
  });

  it('VERIFY.md has the trigger row in the human table', () => {
    const verify = readFileSync(`${root}/docs/VERIFY.md`, 'utf8');
    const human = verify.split('\n## Needs a human\n')[1] ?? '';
    expect(human).toMatch(/^\| 37 \| .*disable trigger user/m);
  });
});
