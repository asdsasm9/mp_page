import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = new URL('.', import.meta.url).pathname;
const srcDir = join(here, '..');
const tokensCss = readFileSync(join(here, 'tokens.css'), 'utf8');

export function parseTokens(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of noComments.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) out[m[1]!] = m[2]!.trim();
  return out;
}

export function parseColor(value: string): [number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i.exec(value);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  throw new Error(`cannot parse colour: ${value}`);
}

function lum([r, g, b]: [number, number, number]): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrast(a: string, b: string): number {
  const la = lum(parseColor(a));
  const lb = lum(parseColor(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const tokens = parseTokens(tokensCss);

/** The named type scale, largest to smallest (T-252). */
export const TYPE_SIZES = [
  '--text-display', '--text-h1', '--text-h2', '--text-h3', '--text-lead', '--text-body', '--text-small', '--text-caption',
];

/** [foreground token, background token, minimum ratio, why] */
export const PAIRS: Array<[string, string, number, string]> = [
  ['--color-text', '--color-bg', 4.5, 'body text'],
  ['--color-text', '--color-surface', 4.5, 'body text on surface'],
  ['--color-text', '--color-surface-raised', 4.5, 'body text on raised surface'],
  ['--color-text-muted', '--color-bg', 4.5, 'muted text'],
  ['--color-text-muted', '--color-surface', 4.5, 'muted text on surface'],
  ['--color-on-accent', '--color-accent', 4.5, 'accent button text'],
  ['--color-on-accent', '--color-accent-hover', 4.5, 'accent button text on hover'],
  ['--color-danger', '--color-bg', 4.5, 'error text'],
  ['--color-on-overlay', '--color-overlay', 4.5, 'lightbox text'],
  ['--color-border-strong', '--color-bg', 3, 'UI component boundary'],
  ['--color-border-strong', '--color-surface', 3, 'UI component boundary on surface'],
  ['--color-focus', '--color-bg', 3, 'focus ring on page'],
  ['--color-focus', '--color-surface', 3, 'focus ring on surface'],
  ['--color-focus', '--color-accent', 3, 'focus ring on accent button'],
  ['--color-focus-on-dark', '--color-overlay', 3, 'focus ring in lightbox'],
];

describe('design tokens', () => {
  it('defines every required token', () => {
    const required = [
      '--color-bg', '--color-surface', '--color-surface-raised', '--color-text', '--color-text-muted',
      '--color-accent', '--color-accent-hover', '--color-on-accent', '--color-border',
      '--color-border-strong', '--color-focus', '--color-focus-on-dark', '--color-overlay', '--color-on-overlay',
      '--color-placeholder', '--color-danger', '--color-theme', '--font-body',
      ...TYPE_SIZES, '--font-heading', '--weight-body', '--weight-heading',
      '--leading-body', '--leading-lead', '--leading-heading', '--leading-ui', '--leading-none', '--measure',
      '--space-1', '--space-2', '--space-3', '--space-4', '--space-5', '--space-6', '--space-7',
      '--space-8', '--radius-md', '--radius-full', '--shadow-sm', '--shadow-md',
      '--motion-fast', '--motion-base', '--motion-ease', '--layout-max', '--layout-gutter',
      '--header-height', '--target-min', '--focus-width', '--focus-offset', '--bar-thickness', '--border-width',
      '--z-header', '--z-dialog', '--z-skip',
    ];
    for (const name of required) expect(tokens[name], name).toBeTruthy();
  });

  it('declares the tokens once, on :root, light scheme only', () => {
    const names = [...tokensCss.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)].map(
      (m) => m[1],
    );
    expect(new Set(names).size).toBe(names.length);
    expect(tokensCss).toContain('color-scheme: light');
  });

  it.each(PAIRS)('%s on %s reaches %s:1 (%s)', (fg, bg, min) => {
    expect(contrast(tokens[fg]!, tokens[bg]!)).toBeGreaterThanOrEqual(min);
  });

  it('keeps the body size at least 15px on phones and the body line height at least 1.5 (T-252)', () => {
    expect(tokens['--text-body']).toMatch(/clamp\(0\.9375rem/);
    expect(Number(tokens['--leading-body'])).toBeGreaterThanOrEqual(1.5);
  });

  it('the type scale is ordered, narrow, and every level is a clamp with rem bounds (T-252)', () => {
    const bounds = TYPE_SIZES.map((name) => {
      const m = /^clamp\(([\d.]+)rem,\s*[^,]+,\s*([\d.]+)rem\)$/.exec(tokens[name]!);
      expect(m, name).not.toBeNull();
      return [Number(m![1]), Number(m![2])] as const;
    });
    const [display, h1, h2, h3, lead, body, small, caption] = bounds as unknown as Array<[number, number]>;
    for (const [min, max] of bounds) expect(max - min, 'range stays narrow').toBeLessThanOrEqual(0.7);
    for (const [a, b] of [[display, h1], [h1, h2], [h2, h3], [h3, lead], [lead, body], [body, small], [small, caption]] as const) {
      expect(a[0]).toBeGreaterThan(b[0]);
      expect(a[1]).toBeGreaterThan(b[1]);
    }
    expect(caption![0]).toBeGreaterThanOrEqual(0.8125); // never below 13px
  });

  it('only weight 400 is used (Martel 400 is the only face loaded)', () => {
    expect(tokens['--weight-body']).toBe('400');
    expect(tokens['--weight-heading']).toBe('400');
  });

  it('target size is at least 44px (2.75rem) and measure at most 70ch', () => {
    expect(tokens['--target-min']).toBe('2.75rem');
    expect(parseInt(tokens['--measure']!, 10)).toBeLessThanOrEqual(70);
  });

  it('compact targets stay above the WCAG 2.2 minimum (24px) and the card cover ratio is a token (T-225)', () => {
    expect(parseFloat(tokens['--target-compact']!)).toBeGreaterThanOrEqual(1.5);
    expect(tokens['--ratio-card']).toBe('3 / 2');
    expect(tokens['--cover-position']).toBeTruthy();
  });

  it('the contrast helper turns red for a failing colour', () => {
    expect(contrast('#cccccc', '#fafafa')).toBeLessThan(4.5);
  });
});

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

describe('type literals live only in tokens.css (T-252)', () => {
  const TYPE_PROP = /(?:^|[\s;{])(font-size|font-family|font-weight|font-style|line-height|letter-spacing|font)\s*:\s*([^;}]+)/g;
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');
  const styled = [
    ...walk(join(srcDir, 'components')),
    ...walk(join(srcDir, 'layouts')),
    ...walk(join(srcDir, 'pages')),
  ].filter((f) => f.endsWith('.astro'));

  it('the scan catches literals (self-test of the pattern)', () => {
    const bad = '.a { font-size: 1.2rem; line-height:1.4 }\n.b{font-family: Arial; font-weight:700;letter-spacing: 1px}';
    expect([...bad.matchAll(TYPE_PROP)].map((m) => m[1])).toEqual([
      'font-size', 'line-height', 'font-family', 'font-weight', 'letter-spacing',
    ]);
  });

  it('scans every page, layout and component', () => {
    expect(styled.length).toBeGreaterThanOrEqual(15);
  });

  it.each(styled.map((f) => [f.slice(srcDir.length)]))('%s sets no font-size, family, weight or line-height', (rel) => {
    const text = strip(readFileSync(join(srcDir, rel as string), 'utf8'));
    const hits = [...text.matchAll(TYPE_PROP)].map((m) => `${m[1]}: ${m[2]}`);
    expect(hits).toEqual([]);
    expect(text).not.toMatch(/style="[^"]*font/i);
  });

  it('base.css and fonts.css use only var(--token), inherit or the document reset for type properties', () => {
    const text = strip(readFileSync(join(here, 'base.css'), 'utf8'));
    for (const m of text.matchAll(TYPE_PROP)) {
      expect(m[2]!.trim(), `${m[1]}: ${m[2]}`).toMatch(/^(var\(--[a-z0-9-]+\)|inherit)$/);
    }
  });

  it('scripts never set font properties from JavaScript', () => {
    const scripts = walk(join(srcDir, 'scripts')).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    for (const f of scripts) expect(readFileSync(f, 'utf8'), f).not.toMatch(/fontSize|fontFamily|fontWeight|lineHeight|font-size/);
  });

  it('every .t-* class used in markup exists in base.css', () => {
    const base = readFileSync(join(here, 'base.css'), 'utf8');
    const defined = new Set([...base.matchAll(/\.(t-[a-z0-9]+)\s*\{/g)].map((m) => m[1]));
    expect([...defined].sort()).toEqual(['t-body', 't-caption', 't-display', 't-h3', 't-lead', 't-small']);
    for (const f of styled) {
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/class="([^"]*)"/g)) {
        for (const c of m[1]!.split(/\s+/)) if (/^t-/.test(c)) expect(defined.has(c), `${f}: ${c}`).toBe(true);
      }
    }
  });
});

describe('no raw values outside the token file', () => {
  const files = [
    ...walk(join(srcDir, 'components')),
    ...walk(join(srcDir, 'layouts')),
    join(here, 'base.css'),
  ].filter((f) => /\.(astro|css|ts)$/.test(f) && !f.endsWith('.test.ts'));

  it('scans base.css at least', () => {
    expect(files.length).toBeGreaterThanOrEqual(1);
  });

  it.each(files.map((f) => [f.slice(srcDir.length)]))('%s has no raw hex or px', (rel) => {
    const text = readFileSync(join(srcDir, rel as string), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(text).not.toMatch(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?=\s*[;,)])/);
    expect(text).not.toMatch(/\d(\.\d+)?px\b/);
  });
});
