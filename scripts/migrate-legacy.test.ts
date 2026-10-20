import { describe, expect, it } from 'vitest';
import { parseArgs, USAGE } from './migrate-legacy/args';
import { main } from './migrate-legacy';

describe('migrate-legacy scaffold', () => {
  it('--help prints usage and exits 0', () => {
    const lines: string[] = [];
    expect(main(['--help'], (l) => lines.push(l))).toBe(0);
    expect(lines.join('\n')).toBe(USAGE);
    expect(USAGE).toContain('--confirm-project');
  });

  it('defaults to a dry-run', () => {
    const o = parseArgs([]);
    expect(o.live).toBe(false);
    expect(o.confirmProject).toBeNull();
    expect(o.alt).toBe('null');
  });

  it('parses flags with values', () => {
    const o = parseArgs(['--live', '--confirm-project', 'abc', '--album', 'lucka_filip', '--limit-bytes', '100', '--repair', '--alt', 'default']);
    expect(o).toMatchObject({ live: true, confirmProject: 'abc', album: 'lucka_filip', limitBytes: 100, repair: true, alt: 'default' });
  });

  it('exits 2 on unknown or malformed options', () => {
    const quiet = () => {};
    expect(main(['--nope'], quiet, quiet)).toBe(2);
    expect(main(['--album'], quiet, quiet)).toBe(2);
    expect(main(['--limit-bytes', 'x'], quiet, quiet)).toBe(2);
  });
});
