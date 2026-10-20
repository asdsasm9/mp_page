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

describe('design pass: surfaces and tables', () => {
  const ruleOf = (selector: string) => {
    const esc = selector.replace(/[.[\]()'=>:]/g, '\\$&');
    return [...css.matchAll(new RegExp(`\\n  ${esc} \\{[^}]*\\}`, 'g'))].map((m) => m[0]).join('\n');
  };

  it.each(['.panel', '.storage-large', '.finding', '.publish-card'])('%s has the row shadow', (sel) => {
    expect(ruleOf(sel)).toContain('box-shadow: var(--shadow-sm)');
  });

  it('quiets the table header and highlights hovered body rows', () => {
    const head = ruleOf('.data-table thead th');
    expect(head).toContain('color: var(--color-text-muted)');
    expect(head).toContain('font-size: var(--font-size-small)');
    expect(ruleOf('.data-table tbody tr:hover')).toContain('background: var(--color-surface)');
  });

  it('transitions the row hover only inside the no-preference block', () => {
    const block = css.match(/@media \(prefers-reduced-motion: no-preference\) \{\s*\.data-table tbody tr \{[^}]*\}/)?.[0] ?? '';
    expect(block).toContain('transition: background-color');
    expect(css.match(/\.data-table tbody tr \{[^}]*transition/g)?.length).toBe(1);
  });
});

describe('design pass: buttons, badges, destructive demotion', () => {
  const ruleOf = (selector: string) => {
    const esc = selector.replace(/[.[\]()'=>:]/g, '\\$&');
    return css.match(new RegExp(`\\n  ${esc} \\{[^}]*\\}`))?.[0] ?? '';
  };

  it('outlines the danger button in page headers with danger text', () => {
    const rule = ruleOf('.header-actions .button-danger');
    expect(rule).toContain('color: var(--color-danger)');
    expect(rule).toContain('background: transparent');
    expect(ruleOf('.header-actions .button-danger:hover')).toContain('color-mix(in srgb, var(--color-danger) 10%, transparent)');
  });

  it('keeps the base danger button solid and never demotes it inside dialogs', () => {
    const base = ruleOf('.button-danger');
    expect(base).toContain('background: var(--color-danger)');
    expect(base).toContain('color: var(--color-on-overlay)');
    expect(css).not.toMatch(/\.dialog[^{]*\.button-danger[^{]*\{[^}]*transparent/);
  });

  it('gives row buttons a transparent base with a surface hover', () => {
    expect(ruleOf('.row-actions .button:not(.button-primary):not(.button-danger)')).toContain('background: transparent');
    expect(ruleOf('.row-actions .button:not(.button-primary):not(.button-danger):hover')).toContain(
      'background: var(--color-surface)',
    );
  });

  it('fills badges per real data-state value and darkens pressed buttons without transform', () => {
    expect(ruleOf(".badge[data-state='published'],\n  .badge[data-state='visible']")).toContain('background: var(--color-surface)');
    expect(ruleOf(".badge[data-state='hidden']")).toContain('background: transparent');
    expect(ruleOf(".badge[data-state='unpublished']")).toContain('background: transparent');
    const active = ruleOf('.button:active:not(:disabled)');
    expect(active).toContain('filter: brightness(');
    expect(active).not.toContain('transform');
  });

  it('transitions buttons only inside the no-preference block', () => {
    const block = css.match(/@media \(prefers-reduced-motion: no-preference\) \{\s*\.button \{[^}]*\}/)?.[0] ?? '';
    expect(block).toContain('border-color');
    expect(css.match(/\.button \{[^}]*transition/g)?.length).toBe(1);
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
