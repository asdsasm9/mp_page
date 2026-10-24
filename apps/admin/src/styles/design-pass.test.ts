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

const ruleOfAny = (selector: string) => {
  const esc = selector.replace(/[.[\]()'=>:]/g, '\\$&');
  return [...css.matchAll(new RegExp(`\\n  ${esc} \\{[^}]*\\}`, 'g'))].map((m) => m[0]).join('\n');
};

describe('design pass: type hierarchy and rhythm', () => {
  it('sets h1 to text-h2 and gives h2 and h3 the smaller text-h3, all in Cormorant (WP-13)', () => {
    expect(css).toMatch(/\n\s*h1\s*\{[^}]*font-size: var\(--text-h2\)/);
    expect(css).toMatch(/\n\s*h2,\s*h3\s*\{[^}]*font-size: var\(--text-h3\)/);
    expect(css).toMatch(/\n\s*h1,\s*h2,\s*h3\s*\{[^}]*font-family: var\(--font-heading\)/);
  });

  it('sets the body in Lora 400 with no synthesized weight, and keeps inputs at 1rem', () => {
    const body = css.match(/\n\s*body\s*\{[^}]*\}/)?.[0] ?? '';
    expect(body).toContain('font-family: var(--font-body)');
    expect(body).toContain('font-size: var(--text-body)');
    expect(body).toContain('font-synthesis: none');
    expect(css.match(/\n\s*input \{[^}]*\}/)?.[0] ?? '').toContain('font-size: var(--font-size-ui)');
  });

  it('has no 700 or 600 literal weights: tiny labels use the --font-ui 600 token', () => {
    expect(css).not.toMatch(/font-weight:\s*(?:[1-9]00|bold|bolder)\b/);
    expect(ruleOfAny('.badge')).toContain('font-family: var(--font-ui)');
    expect(ruleOfAny('.badge')).toContain('font-weight: var(--weight-ui-strong)');
    expect(ruleOfAny('.data-table thead th')).toContain('font-family: var(--font-ui)');
  });

  it('uses the public scale and leading tokens only', () => {
    expect(css).not.toMatch(/--font-size-(?:\d|small)\b|--line-height-/);
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
    expect(head).toContain('font-size: var(--text-caption)');
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
    expect(base).toContain('color: var(--color-on-danger)');
    expect(css).not.toMatch(/\.dialog[^{]*\.button-danger[^{]*\{[^}]*transparent/);
  });

  it('T-250: every solid danger state uses on-danger text and has >= 4.5:1 contrast', () => {
    const tokens = read('./tokens.css');
    const hex = (name: string) => tokens.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1] ?? '';
    const lum = (h: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) =>
        c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
      );
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a: string, b: string) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    const text = hex('color-on-danger');
    expect(text).not.toBe('');
    for (const bg of ['color-danger', 'color-danger-hover', 'color-danger-active', 'color-danger-disabled']) {
      expect(hex(bg), bg).not.toBe('');
      expect(ratio(text, hex(bg)), bg).toBeGreaterThanOrEqual(4.5);
    }
    // Each state rule sets the matching background and never a muted/filtered text colour.
    for (const sel of [
      '.button-danger',
      '.button-danger:disabled',
      ".button-danger[aria-disabled='true']",
    ]) {
      expect(ruleOf(sel), sel).toContain('color: var(--color-on-danger)');
    }
    expect(ruleOf('.button-danger:hover:not(:disabled)')).toContain('background: var(--color-danger-hover)');
    expect(ruleOf('.button-danger:hover:not(:disabled)')).toContain('filter: none');
    expect(ruleOf('.button-danger:active:not(:disabled)')).toContain('background: var(--color-danger-active)');
    expect(ruleOf('.button-danger:active:not(:disabled)')).toContain('filter: none');
    expect(ruleOf('.button-danger:disabled')).toContain('background: var(--color-danger-disabled)');
  });

  it('T-250: icon-only danger buttons stay red-on-transparent, with a readable tint on hover', () => {
    expect(ruleOf('.row-actions .button-icon.button-icon-danger')).toContain('color: var(--color-danger)');
    expect(ruleOf('.row-actions .button-icon.button-icon-danger:hover:not(:disabled)')).toContain('color-mix(in srgb, var(--color-danger) 10%');
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

describe('design pass: forms and login', () => {
  it('clears the login card from the top edge with space-7', () => {
    const rule = css.match(/\n  \.login-card \{[^}]*\}/)?.[0] ?? '';
    expect(rule).toContain('margin-block-start: var(--space-7)');
  });

  it('darkens input and textarea borders on hover, never on invalid fields', () => {
    const rule = css.match(/\n  input:hover[^{]*\{[^}]*\}/)?.[0] ?? '';
    expect(rule).toContain('textarea:hover');
    expect(rule).toContain(":not([aria-invalid='true'])");
    expect(rule).toContain('border-color: var(--color-text)');
  });

  it('transitions field borders only inside the no-preference block and keeps the global focus ring', () => {
    const block = css.match(/@media \(prefers-reduced-motion: no-preference\) \{[^@]*?input,\s*textarea \{[^}]*\}/)?.[0] ?? '';
    expect(block).toContain('transition: border-color');
    expect(css.match(/\n\s*(?:input|textarea)[^{]*\{[^}]*transition/g)?.length).toBe(1);
    expect(css).toMatch(/:focus-visible\s*\{\s*outline: var\(--focus-width\) solid var\(--color-focus\)/);
    expect(css).not.toMatch(/(?:input|textarea)[^{]*:focus[^{]*\{[^}]*outline:\s*(?:none|0)/);
  });
});

describe('design pass: photo grid and upload surfaces', () => {
  it('lifts tile overlay controls and the badge with the small shadow', () => {
    const controls = css.match(/\n  \.photo-handle,\s*\.photo-menu-button,\s*\.photo-check \{[^}]*\}/)?.[0] ?? '';
    expect(controls).toContain('box-shadow: var(--shadow-sm)');
    const badge = css.match(/\n  \.photo-badge \{[^}]*\}/)?.[0] ?? '';
    expect(badge).toContain('box-shadow: var(--shadow-sm)');
  });

  it('raises the hovered tile to shadow-md, transitioning only under no-preference', () => {
    expect(css.match(/\n  \.photo-tile:hover \{[^}]*\}/)?.[0] ?? '').toContain('box-shadow: var(--shadow-md)');
    const block = css.match(/@media \(prefers-reduced-motion: no-preference\) \{\s*\.photo-tile \{[^}]*\}/)?.[0] ?? '';
    expect(block).toContain('transition: box-shadow');
    expect(css.match(/\.photo-tile \{[^}]*transition/g)?.length).toBe(1);
  });

  it('wraps the gallery toolbar with a space-3 gap and spaces the dropzone and upload rows with tokens', () => {
    const bar = css.match(/\n  \.gallery-toolbar \{[^}]*\}/)?.[0] ?? '';
    expect(bar).toContain('flex-wrap: wrap');
    expect(bar).toContain('gap: var(--space-3)');
    expect(css.match(/\n  \.dropzone \{[^}]*\}/)?.[0] ?? '').toMatch(/gap: var\(--space-\d\)/);
    expect(css.match(/\n  \.upload-row \{[^}]*\}/)?.[0] ?? '').toMatch(/gap: var\(--space-\d\) var\(--space-\d\)/);
  });
});

describe('design pass: phone and shell polish', () => {
  const phone = css.match(/@media \(max-width: 39\.99rem\) \{\s*\.desktop-nav \{[\s\S]*?\n  \}\n/)?.[0] ?? '';

  it('divides the stacked row actions from the title inside the phone block', () => {
    const rule = phone.match(/\.row-actions \{[^}]*\}/)?.[0] ?? '';
    expect(rule).toContain('border-block-start: var(--border-width) solid var(--color-border)');
    expect(rule).toContain('padding-block-start: var(--space-3)');
  });

  it('marks the active bottom-nav item and keeps its 44 px height', () => {
    const rule = phone.match(/\.bottom-nav \.nav-link\[aria-current='page'\] \{[^}]*\}/)?.[0] ?? '';
    expect(rule).toContain('background: var(--color-surface)');
    expect(rule).toContain('border-block-end-color: var(--color-text)');
    expect(phone).toContain('min-block-size: var(--bottom-nav-height)');
  });

  it('gives the shell header a small shadow on phone and keeps it sticky (T-245)', () => {
    expect(phone.match(/\.shell-header \{[^}]*\}/)?.[0] ?? '').toContain('box-shadow: var(--shadow-sm)');
    const rule = css.match(/\.shell-header \{[^}]*position: sticky[^}]*\}/)?.[0] ?? '';
    expect(rule).toContain('inset-block-start: 0');
    expect(rule).toContain('z-index: var(--z-header)');
    expect(css).toMatch(/html \{[^}]*scroll-padding-block-start: var\(--header-height\)/);
    expect(css).toMatch(/79\.99rem\) \{\s*html \{[^}]*scroll-padding-block-start: var\(--header-height-wrapped\)/);
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
