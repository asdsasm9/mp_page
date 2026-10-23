import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NAV } from '../content/texts';
import { buildNav, isPortfolioPage, navCurrent, normalizeBrand, wordmarkCurrent } from './nav';
import { BRAND } from './seo';

const items = buildNav(NAV, true);
const marked = (current: string): string[] =>
  items.filter((i) => navCurrent(current, i) !== undefined).map((i) => i.anchor);

describe('buildNav', () => {
  it('lists O mně, Portfolio, Reference and a framed Kontakt, all as home anchors', () => {
    expect(items.map((i) => [i.label, i.href, i.anchor, Boolean(i.framed)])).toEqual([
      ['O mně', '/#o-mne', 'o-mne', false],
      ['Portfolio', '/#portfolio', 'portfolio', false],
      ['Reference', '/#reference', 'reference', false],
      ['Kontakt', '/#kontakt', 'kontakt', true],
    ]);
  });

  it('leaves Reference out when there are no reviews', () => {
    expect(buildNav(NAV, false).map((i) => i.anchor)).toEqual(['o-mne', 'portfolio', 'kontakt']);
  });

  it('keeps Reference for exactly one review', () => {
    expect(buildNav(NAV, true).map((i) => i.anchor)).toContain('reference');
  });

  it('has no category links', () => {
    expect(items.some((i) => /^\/(svatby|portrety|parove-foceni)\//.test(i.href))).toBe(false);
  });
});

describe('aria-current in the header nav', () => {
  it('marks nothing on the home page (scrollspy sets "location" in the browser)', () => {
    expect(marked('/')).toEqual([]);
  });

  it('marks Portfolio with "true" on /portfolio/, a category page and an album page', () => {
    for (const path of ['/portfolio/', '/svatby/', '/svatby/sedlakovi/']) {
      expect(marked(path), path).toEqual(['portfolio']);
      expect(navCurrent(path, items[1]!)).toBe('true');
    }
  });

  it('marks nothing on cookies, 404 and the removed pages', () => {
    for (const path of ['/cookies/', '/404/', '/o-mne/', '/kontakt/']) expect(marked(path), path).toEqual([]);
    expect(isPortfolioPage('/cookies/')).toBe(false);
  });

  it('never uses "page" on a nav item', () => {
    for (const path of ['/', '/portfolio/', '/svatby/', '/svatby/sedlakovi/', '/cookies/']) {
      for (const item of items) expect(navCurrent(path, item)).not.toBe('page');
    }
  });

  it('the wordmark link claims "page" on the home page only', () => {
    expect(wordmarkCurrent('/')).toBe('page');
    expect(wordmarkCurrent('/svatby/')).toBeUndefined();
  });
});

describe('wordmark and brand', () => {
  it('are the same word modulo space and case', () => {
    expect(normalizeBrand(NAV.wordmark)).toBe(normalizeBrand(BRAND));
    expect(BRAND).toBe('Mullny Photos'); // title, og:site_name and JSON-LD keep the spaced form
  });
});

describe('Header.astro wiring', () => {
  const src = readFileSync(new URL('../components/Header.astro', import.meta.url), 'utf8');

  it('uses the nav helpers for aria-current', () => {
    expect(src).toContain('aria-current={navCurrent(current, item)}');
    expect(src).toContain('aria-current={wordmarkCurrent(current)}');
  });

  it('never puts backdrop-filter on .site-header itself (containing-block trap for the fixed drawer)', () => {
    const css = src.slice(src.indexOf('<style>'));
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/backdrop-filter\s*:/.test(rule[2]!)) continue;
      expect(rule[1]!.trim(), rule[1]).toMatch(/::before$/);
    }
    expect(css).toContain('backdrop-filter');
  });
});
