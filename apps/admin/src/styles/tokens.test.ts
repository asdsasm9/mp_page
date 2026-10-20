import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

function tokens(css: string): Map<string, string> {
  const map = new Map<string, string>();
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of clean.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    map.set(m[1]!, m[2]!.replace(/\s+/g, ' ').trim());
  }
  return map;
}

const web = tokens(read('../../../web/src/styles/tokens.css'));
const admin = tokens(read('./tokens.css'));

describe('token parity with apps/web', () => {
  it('reads a real token set from both files', () => {
    expect(web.size).toBeGreaterThan(40);
    expect(admin.size).toBeGreaterThanOrEqual(web.size);
  });

  it.each([...web.entries()])('%s has the web value', (name, value) => {
    expect(admin.get(name)).toBe(value);
  });

  it('keeps the admin-only extras small and named', () => {
    const extras = [...admin.keys()].filter((k) => !web.has(k)).sort();
    expect(extras).toEqual(['--bottom-nav-height', '--font-size-ui', '--font-ui']);
  });
});

describe('app.css', () => {
  const css = read('./app.css').replace(/\/\*[\s\S]*?\*\//g, '');

  it('uses tokens only: no hex or rgb colours, no px except none', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(/);
    expect(css).not.toMatch(/\d\s*px\b/);
  });

  it('switches to the phone bottom navigation under 40rem (640 px)', () => {
    expect(css).toMatch(/@media \(max-width: 39\.99rem\)/);
  });

  it('honours reduced motion and has no 100vh', () => {
    expect(css).toMatch(/prefers-reduced-motion: no-preference/);
    expect(css).not.toMatch(/100vh/);
  });
});
