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
    expect(web.size).toBeGreaterThan(80);
    expect(admin.size).toBeGreaterThanOrEqual(web.size);
  });

  // WP-13: the admin uses the public site's type scale verbatim, so every web token (type included) is compared.
  it.each([...web.entries()])('%s has the web value', (name, value) => {
    expect(admin.get(name)).toBe(value);
  });

  it('keeps the admin-only extras small and named', () => {
    const extras = [...admin.keys()].filter((k) => !web.has(k)).sort();
    expect(extras).toEqual([
      '--bottom-nav-height', '--color-accent-fill-hover', '--color-danger-active', '--color-danger-disabled', '--color-danger-hover', '--color-on-danger',
      '--cover-size', '--font-size-ui', '--font-ui', '--header-height-wrapped', '--icon-size', '--icon-stroke', '--weight-ui-strong',
    ]);
  });

  it('has dropped the legacy admin type scale', () => {
    expect([...admin.keys()].filter((k) => /^--(font-size-(\d|small)|line-height-)/.test(k))).toEqual([]);
    expect(read('./app.css')).not.toMatch(/--font-size-(\d|small)\b|--line-height-/);
  });
});

describe('gold primary button contrast (WP-12 palette)', () => {
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const f = (c: number) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
  };
  const ratio = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

  it('on-accent text reaches 4.5:1 on the gold fill and on its admin hover fill', () => {
    expect(ratio(admin.get('--color-on-accent')!, admin.get('--color-accent')!)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(admin.get('--color-on-accent')!, admin.get('--color-accent-fill-hover')!)).toBeGreaterThanOrEqual(4.5);
  });

  it('the web hover colour would fail as a button fill, which is why the admin has its own (negative test)', () => {
    expect(ratio(admin.get('--color-on-accent')!, admin.get('--color-accent-hover')!)).toBeLessThan(4.5);
  });

  it('the primary button hover uses the admin fill token', () => {
    const css = read('./app.css');
    expect(css).toMatch(/\.button-primary:hover\s*\{\s*background: var\(--color-accent-fill-hover\)/);
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
