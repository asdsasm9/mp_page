/** WP-15 source checks for the Instagram preview styles: nothing of the old legend or dashed outline, tokens only, no third-party host. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const css = read('./app.css');
const igRules = css.slice(css.indexOf('/* Instagram preview'), css.indexOf('/* Post editor (WP-14)'));

describe('Instagram preview styles', () => {
  it('has the preview block and no legend, swatch, badge or dashed tile outline left', () => {
    expect(igRules.length).toBeGreaterThan(500);
    expect(css).not.toMatch(/\.ig-legend|\.ig-swatch|\.ig-badge/);
    expect(igRules).not.toMatch(/dashed/);
    expect(igRules).not.toMatch(/\.ig-tile:not/);
  });

  it('takes the grid gap and the avatar size from tokens, and uses no opacity, raw colour or px value', () => {
    expect(igRules).toMatch(/\.ig-grid \{[^}]*gap: var\(--ig-grid-gap\)/);
    expect(igRules).toMatch(/\.ig-avatar \{[^}]*var\(--ig-avatar-size\)/);
    expect(igRules).not.toMatch(/opacity\s*:/);
    expect(igRules).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|\d\s*px\b/);
  });

  it('draws the carousel mark as a plain icon: no background, border or radius', () => {
    const rule = igRules.match(/\.ig-carousel \{[^}]*\}/)?.[0] ?? '';
    expect(rule).not.toBe('');
    expect(rule).not.toMatch(/background|border|padding/);
  });
});
