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

/** The named type scale, largest to smallest (T-252, WP-12). `quote` sits between h2 and h3 by size range, so it is listed apart. */
export const TYPE_SIZES = [
  '--text-display', '--text-title', '--text-h1', '--text-h2', '--text-h3', '--text-lead', '--text-body', '--text-small', '--text-caption',
];
/** Headline levels set in Cormorant Garamond (never under 1.25rem = 20 px). */
export const HEADING_SIZES = ['--text-display', '--text-title', '--text-h1', '--text-h2', '--text-h3', '--text-quote', '--text-wordmark'];
/** Levels exempt from the "narrow range" rule: they scale with the viewport on purpose. */
export const WIDE_RANGE = ['--text-display', '--text-title', '--text-h1', '--text-quote'];

/** [foreground token, background token, minimum ratio, why] */
export const PAIRS: Array<[string, string, number, string]> = [
  ['--color-text', '--color-bg', 4.5, 'body text'],
  ['--color-text', '--color-surface', 4.5, 'body text on the alternate band'],
  ['--color-text', '--color-surface-raised', 4.5, 'body text on raised surface'],
  ['--color-text-muted', '--color-bg', 4.5, 'muted text'],
  ['--color-text-muted', '--color-surface', 4.5, 'muted text on the alternate band'],
  ['--color-accent-text', '--color-bg', 4.5, 'accent-coloured text'],
  ['--color-accent-text', '--color-surface', 4.5, 'accent-coloured text on the alternate band'],
  ['--color-accent-strong', '--color-bg', 3, 'outlined button and framed nav boundary'],
  ['--color-accent-strong', '--color-surface', 3, 'outlined button boundary on the alternate band'],
  ['--color-accent', '--color-bg', 3, 'accent decoration on the page (decoration only)'],
  ['--color-on-accent', '--color-accent', 4.5, 'skip link text on accent'],
  ['--color-danger', '--color-bg', 4.5, 'error text'],
  ['--color-on-overlay', '--color-overlay', 4.5, 'lightbox text'],
  ['--color-border-strong', '--color-bg', 3, 'UI component boundary'],
  ['--color-border-strong', '--color-surface', 3, 'UI component boundary on the alternate band'],
  ['--color-focus', '--color-bg', 3, 'focus ring on page'],
  ['--color-focus', '--color-surface', 3, 'focus ring on the alternate band'],
  ['--color-focus-on-dark', '--band-dark-bg', 3, 'focus ring on the dark band'],
  ['--color-focus-on-dark', '--color-overlay', 3, 'focus ring in lightbox and hero'],
  ['--band-dark-text', '--band-dark-bg', 4.5, 'text on the dark band'],
  ['--band-dark-muted', '--band-dark-bg', 4.5, 'muted text on the dark band'],
  ['--band-dark-accent', '--band-dark-bg', 4.5, 'accent text on the dark band'],
];

describe('design tokens', () => {
  it('defines every required token', () => {
    const required = [
      '--color-bg', '--color-surface', '--color-surface-raised', '--color-text', '--color-text-muted',
      '--color-accent', '--color-accent-strong', '--color-accent-text', '--color-accent-hover', '--color-on-accent',
      '--color-border', '--color-border-strong', '--color-focus', '--color-focus-on-dark', '--color-overlay',
      '--color-on-overlay', '--scrim-hero-from', '--scrim-hero-to', '--color-placeholder', '--color-danger',
      '--color-theme', '--band-dark-bg', '--band-dark-text', '--band-dark-muted', '--band-dark-accent', '--font-body',
      ...TYPE_SIZES, '--text-quote', '--text-kicker', '--text-nav', '--font-heading', '--weight-body', '--weight-heading',
      '--leading-body', '--leading-prose', '--leading-lead', '--leading-heading', '--leading-caps', '--leading-ui',
      '--leading-none', '--tracking-heading', '--tracking-label', '--tracking-wordmark', '--measure',
      '--space-1', '--space-2', '--space-3', '--space-4', '--space-5', '--space-6', '--space-7',
      '--space-8', '--radius-none', '--radius-md', '--radius-full', '--shadow-sm', '--shadow-md',
      '--motion-fast', '--motion-base', '--motion-drawer', '--motion-ease', '--layout-max', '--layout-gutter',
      '--header-height', '--section-pad', '--section-gap-lg', '--drawer-width', '--target-min', '--ratio-category',
      '--ratio-album', '--focus-width', '--focus-offset', '--bar-thickness', '--border-width',
      '--z-header', '--z-dialog', '--z-drawer', '--z-skip',
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

  const bound = (name: string): readonly [number, number] => {
    const m = /^clamp\(([\d.]+)rem,\s*[^,]+,\s*([\d.]+)rem\)$/.exec(tokens[name]!);
    expect(m, name).not.toBeNull();
    return [Number(m![1]), Number(m![2])] as const;
  };

  it('the type scale is ordered and every level is a clamp with rem bounds (T-252)', () => {
    const bounds = TYPE_SIZES.map(bound);
    for (let i = 0; i < bounds.length - 1; i++) {
      expect(bounds[i]![0], `${TYPE_SIZES[i]} min > ${TYPE_SIZES[i + 1]} min`).toBeGreaterThan(bounds[i + 1]![0]);
      expect(bounds[i]![1], `${TYPE_SIZES[i]} max > ${TYPE_SIZES[i + 1]} max`).toBeGreaterThan(bounds[i + 1]![1]);
    }
    expect(bound('--text-caption')[0]).toBeGreaterThanOrEqual(0.8125); // never below 13px
  });

  it('every level stays in a narrow range except the headline levels that scale on purpose (WIDE_RANGE)', () => {
    expect(WIDE_RANGE).toEqual(['--text-display', '--text-title', '--text-h1', '--text-quote']);
    for (const name of TYPE_SIZES.filter((n) => !WIDE_RANGE.includes(n))) {
      const [min, max] = bound(name);
      expect(max - min, `${name} range stays narrow`).toBeLessThanOrEqual(0.7);
    }
  });

  it('the label levels (kicker, nav) are never under 12px', () => {
    expect(bound('--text-kicker')[0]).toBeGreaterThanOrEqual(0.75);
    expect(bound('--text-nav')[0]).toBeGreaterThanOrEqual(0.75);
  });

  it('no fluid size grows beyond its 1440px value: 1920 and 2560 equal 1440 (T-314)', () => {
    const names = [...TYPE_SIZES, '--text-quote', '--text-kicker', '--text-nav', '--text-wordmark'];
    const at = (name: string, vw: number): number => {
      const m = /^clamp\(([\d.]+)rem,\s*([^,]+),\s*([\d.]+)rem\)$/.exec(tokens[name]!);
      expect(m, name).not.toBeNull();
      let preferred = 0;
      for (const part of m![2]!.split('+').map((s) => s.trim())) {
        const n = parseFloat(part);
        preferred += part.endsWith('vw') ? (n * vw) / 100 : n * 16;
      }
      return Math.min(Math.max(Number(m![1]) * 16, preferred), Number(m![3]) * 16);
    };
    for (const name of names) {
      expect(at(name, 1920), `${name} at 1920`).toBeCloseTo(at(name, 1440), 6);
      expect(at(name, 2560), `${name} at 2560`).toBeCloseTo(at(name, 1440), 6);
    }
    expect(bound('--text-display')[1]).toBeLessThanOrEqual(4.5);
    expect(bound('--text-body')[1]).toBeLessThanOrEqual(1.125);
  });

  it('the card grid column gap is 48 to 64px, at least 1.5 times the former 32px (T-321)', () => {
    const rem = Number(/^([\d.]+)rem$/.exec(tokens['--grid-col-gap']!)?.[1]);
    expect(rem * 16).toBeGreaterThanOrEqual(48);
    expect(rem * 16).toBeLessThanOrEqual(64);
  });

  it('the reference quote holds the full review text: 20 to 24px, line height 1.4 (T-320)', () => {
    expect(bound('--text-quote')).toEqual([1.25, 1.5]);
    expect(Number(tokens['--leading-quote'])).toBe(1.4);
  });

  it('Cormorant (headings) is never set under 20px,and uppercase heading leading is at least 1.12', () => {
    for (const name of HEADING_SIZES) expect(bound(name)[0], name).toBeGreaterThanOrEqual(1.25);
    expect(Number(tokens['--leading-caps'])).toBeGreaterThanOrEqual(1.12);
    expect(Number(tokens['--leading-prose'])).toBeGreaterThanOrEqual(1.7);
  });

  it('the font stacks lead with Cormorant Garamond and Lora and their metric-matched fallbacks', () => {
    expect(tokens['--font-heading']).toMatch(/^'Cormorant Garamond', 'Cormorant Fallback'/);
    expect(tokens['--font-body']).toMatch(/^'Lora', 'Lora Fallback'/);
    expect(tokensCss.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(new RegExp(['mar', 'tel'].join(''), 'i'));
  });

  it('only weight 400 is used (Cormorant 400 and Lora 400 are the only faces loaded)', () => {
    expect(tokens['--weight-body']).toBe('400');
    expect(tokens['--weight-heading']).toBe('400');
  });

  it('the accent is decoration only: below 3:1 on the alternate band, so it can never be a boundary there', () => {
    expect(contrast(tokens['--color-accent']!, tokens['--color-surface']!)).toBeLessThan(3);
    expect(contrast(tokens['--color-accent-strong']!, tokens['--color-surface']!)).toBeGreaterThanOrEqual(3);
  });

  it('a deliberately failing accent-text value turns the pair red', () => {
    expect(contrast('#b68235', tokens['--color-bg']!)).toBeLessThan(4.5);
    expect(contrast(tokens['--color-accent-text']!, tokens['--color-bg']!)).toBeGreaterThanOrEqual(4.5);
  });

  it('the hero scrim ends at 0.7 of the overlay colour (F12) and starts transparent', () => {
    expect(tokens['--scrim-hero-from']).toMatch(/\/ 0\)$/);
    expect(tokens['--scrim-hero-to']).toMatch(/\/ 0\.7\)$/);
  });

  it('target size is at least 44px (2.75rem) and measure at most 70ch', () => {
    expect(tokens['--target-min']).toBe('2.75rem');
    expect(parseInt(tokens['--measure']!, 10)).toBeLessThanOrEqual(70);
  });

  it('compact targets stay above the WCAG 2.2 minimum (24px) and the cover ratios are tokens (T-225, WP-12)', () => {
    expect(parseFloat(tokens['--target-compact']!)).toBeGreaterThanOrEqual(1.5);
    expect(tokens['--ratio-category']).toBe('3 / 4');
    expect(tokens['--ratio-album']).toBe('4 / 5');
    expect(tokens['--cover-position']).toBeTruthy();
  });

  it('layout tokens match the design (110rem frame, 68px header, no radius on images and buttons)', () => {
    expect(tokens['--layout-max']).toBe('110rem');
    expect(tokens['--header-height']).toBe('4.25rem');
    expect(tokens['--section-pad']).toBe('clamp(3.25rem, 7.2vw, 5.5rem)');
    expect(tokens['--radius-none']).toBe('0');
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

  it('Cormorant headings show lining figures (body sets lining-nums, every heading rule inherits it)', () => {
    const text = strip(readFileSync(join(here, 'base.css'), 'utf8'));
    expect(text).toMatch(/\n\s*body\s*\{[^}]*font-variant-numeric: lining-nums/);
    expect(text).not.toMatch(/oldstyle-nums/);
  });

  it('scripts never set font properties from JavaScript', () => {
    const scripts = walk(join(srcDir, 'scripts')).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    for (const f of scripts) expect(readFileSync(f, 'utf8'), f).not.toMatch(/fontSize|fontFamily|fontWeight|lineHeight|font-size/);
  });

  it('every .t-* class used in markup exists in base.css', () => {
    const base = readFileSync(join(here, 'base.css'), 'utf8');
    const defined = new Set([...base.matchAll(/\.(t-[a-z0-9]+)\s*\{/g)].map((m) => m[1]));
    expect([...defined].sort()).toEqual([
      't-body', 't-caption', 't-display', 't-h1', 't-h3', 't-kicker', 't-lead', 't-nav', 't-prose', 't-quote', 't-small', 't-title',
      't-wordmark',
    ]);
    for (const f of styled) {
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/class="([^"]*)"/g)) {
        for (const c of m[1]!.split(/\s+/)) if (/^t-/.test(c)) expect(defined.has(c), `${f}: ${c}`).toBe(true);
      }
    }
  });
});

describe('docs/DESIGN-TOKENS.md', () => {
  const doc = readFileSync(join(here, '..', '..', '..', '..', 'docs', 'DESIGN-TOKENS.md'), 'utf8');

  it.each(Object.keys(tokens))('names %s', (name) => {
    expect(doc, name).toContain(`\`${name}\``);
  });
});

describe('the gold accent is decoration only (WP-12 b)', () => {
  // The only exemption: the `.skip-link` rule in base.css (dark text on a gold fill is 4.9:1).
  const SKIP_LINK_RULE = /\.skip-link\s*\{[^}]*\}/g;
  const files = [
    ...walk(join(srcDir, 'components')),
    ...walk(join(srcDir, 'layouts')),
    ...walk(join(srcDir, 'pages')),
    join(here, 'base.css'),
  ].filter((f) => /\.(astro|css)$/.test(f));
  const FILL = /(?:^|[\s;{])(?:color|background(?:-color)?)\s*:[^;}]*var\(--color-accent\)/g;

  it('the scan catches a fill and ignores strokes (self-test of the pattern)', () => {
    expect('a{background: var(--color-accent)}'.match(FILL)).not.toBeNull();
    expect('a{color:var(--color-accent)}'.match(FILL)).not.toBeNull();
    expect('a{border-color: var(--color-accent)}'.match(FILL)).toBeNull();
    expect('a{text-decoration-color: var(--color-accent)}'.match(FILL)).toBeNull();
    expect('a{color: var(--color-accent-text)}'.match(FILL)).toBeNull();
  });

  it.each(files.map((f) => [f.slice(srcDir.length)]))('%s does not use --color-accent as text or fill', (rel) => {
    const text = readFileSync(join(srcDir, rel as string), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(SKIP_LINK_RULE, '');
    expect(text.match(FILL)).toBeNull();
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
