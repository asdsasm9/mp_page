// Regressions found by the first design-check run (WP3-25).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(new URL(`../pages/${rel}`, import.meta.url), 'utf8');

describe('design-check regressions', () => {
  it('kontakt uses an SVG glyph for the Instagram icon, not the legacy feed screenshot', () => {
    const src = read('kontakt/index.astro');
    expect(src).not.toContain('instagram.png');
    expect(src).toMatch(/<svg class="icon"[^>]*aria-hidden="true"/);
  });

  it('cookies definition list is one column on narrow screens (no 320 px overflow)', () => {
    const src = read('cookies/index.astro');
    expect(src).toMatch(/dl \{[^}]*grid-template-columns: minmax\(0, 1fr\)/s);
    expect(src).toMatch(/@media \(min-width: 48rem\)[\s\S]*grid-template-columns: max-content minmax\(0, 1fr\)/);
  });

  it('sticky footer (T-242): body is a column and main takes the free space, no fixed footer', () => {
    const css = readFileSync(new URL('../styles/base.css', import.meta.url), 'utf8');
    expect(css).toMatch(/body \{[^}]*display: flex;[^}]*flex-direction: column;[^}]*min-block-size: 100dvh/s);
    expect(css).toMatch(/body > main \{[^}]*flex: 1 0 auto/s);
    const footer = readFileSync(new URL('../components/Footer.astro', import.meta.url), 'utf8');
    expect(footer).not.toMatch(/position:\s*(fixed|sticky)/);
  });
});
