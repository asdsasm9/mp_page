/**
 * WP-15 section 9: the admin never talks to Instagram or Meta and never links there. The preview is a typed picture only, so the
 * host name "instagram.com" may appear only in Czech help text under src/i18n, and never as an href, a fetch or a link anywhere.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = import.meta.dirname;
const SELF = join(SRC, 'no-instagram-host.test.ts');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const files = walk(SRC).filter((f) => /\.(tsx?|css|html|svg|json)$/.test(f) && f !== SELF);
const rel = (f: string) => relative(SRC, f).split(sep).join('/');

describe('no Instagram or Meta host in apps/admin/src', () => {
  it('scans the source tree', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.map(rel)).toContain('i18n/cs.ts');
  });

  it('mentions "instagram.com" only in i18n help text', () => {
    const offenders = files.filter((f) => /instagram\.com/i.test(readFileSync(f, 'utf8'))).map(rel);
    expect(offenders.filter((f) => !f.startsWith('i18n/'))).toEqual([]);
  });

  it('has no href, src, action, fetch or window.open towards instagram or a Meta host, even in i18n', () => {
    const host = String.raw`(?:instagram\.com|facebook\.com|fb\.com|graph\.facebook|cdninstagram|meta\.com)`;
    const link = new RegExp(String.raw`(?:href|src|action|to)\s*[=:]\s*[^\n]{0,40}${host}|(?:fetch|open)\(\s*[^\n)]{0,40}${host}|https?://[^\s'"\`]*${host}`, 'i');
    const offenders = files.filter((f) => link.test(readFileSync(f, 'utf8'))).map(rel);
    expect(offenders).toEqual([]);
  });

  it('the profile link and buttons are text: no anchor is rendered by the profile header', () => {
    const header = readFileSync(join(SRC, 'components', 'ProfileHeader.tsx'), 'utf8');
    expect(header).not.toMatch(/<a[\s>]|<Link\b|href=/);
  });
});
