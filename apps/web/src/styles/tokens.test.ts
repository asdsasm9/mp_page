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
      '--font-size-0', '--font-size-1', '--font-size-2', '--font-size-3', '--font-size-4',
      '--font-size-5', '--line-height-body', '--measure',
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

  it('keeps the base size at least 17px and the line height at least 1.5', () => {
    expect(tokens['--font-size-0']).toMatch(/clamp\(1\.0625rem/);
    expect(Number(tokens['--line-height-body'])).toBeGreaterThanOrEqual(1.5);
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
