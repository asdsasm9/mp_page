/**
 * CSS-source guards for the WP-08a admin design pass (CSS only, tokens only). jsdom has no layout, so these read
 * the sources; `npm run admin-check` proves the rendered result. Later steps add their own assertions here.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const raw = read('./app.css');
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');

describe('design pass: token-only CSS', () => {
  it('has no literal hex or rgb(a) colours in app.css', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(/);
  });

  it('has no literal px lengths in app.css', () => {
    expect(css).not.toMatch(/\d\s*px\b/);
  });

  it('keeps the single phone breakpoint, reduced-motion guard and no 100vh', () => {
    expect(css).toMatch(/@media \(max-width: 39\.99rem\)/);
    expect(css).toMatch(/prefers-reduced-motion: no-preference/);
    expect(css).not.toMatch(/100vh/);
  });
});

describe('design pass: type hierarchy and rhythm', () => {
  it('sets h1 to font-size-2 and gives h2 its own smaller rule', () => {
    expect(css).toMatch(/\n\s*h1\s*\{[^}]*font-size: var\(--font-size-2\)/);
    expect(css).toMatch(/\n\s*h2\s*\{[^}]*font-size: var\(--font-size-1\)/);
  });

  it('separates sections with a space-6 top margin on page h2', () => {
    const rule = css.match(/\.page > h2,\s*\.page > section > h2\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule).toContain('margin-block-start: var(--space-6)');
  });
});

describe('design pass: existing finding guards remain', () => {
  it('keeps the 44 px target rule for stand-alone links and list titles', () => {
    const rule = css.match(/\.row-title,[^{]*\{[^}]*\}/)?.[0] ?? '';
    expect(rule).toContain('.page > p > a:only-child');
    expect(rule).toContain('min-block-size: var(--target-min)');
    expect(rule).toContain('min-inline-size: var(--target-min)');
  });

  it('keeps short album names in the storage table at 44 px wide', () => {
    const rule = css.match(/\.data-table a \{[^}]*\}/)?.[0] ?? '';
    expect(rule).toContain('min-inline-size: var(--target-min)');
  });

  it('keeps room for the fixed upload queue', () => {
    expect(css).toContain('.shell:has(.upload-drawer) .shell-main');
    expect(css).toMatch(/html:has\(\.upload-drawer\)\s*\{[^}]*scroll-padding-block-end/);
  });

  it('keeps the summary chevron and the one-row desktop top bar', () => {
    expect(css).toContain('.details summary::before');
    expect(css).toContain('.details[open] > summary::before');
    expect(css).toMatch(/\.desktop-nav \.nav-list\s*\{\s*gap: 0;/);
    expect(css).toMatch(/\.desktop-nav \.nav-link\s*\{\s*padding-inline: var\(--space-2\);/);
  });
});
