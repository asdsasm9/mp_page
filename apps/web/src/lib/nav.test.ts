import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NAV } from '../content/texts';
import { buildNav, isPortfolioPage, navCurrent, normalizeBrand, wordmarkCurrent } from './nav';
import { BRAND } from './seo';

const items = buildNav(NAV);
const marked = (current: string): string[] =>
  items.filter((i) => navCurrent(current, i) !== undefined).map((i) => i.anchor);

describe('buildNav', () => {
  it('lists Úvod (/), O mně (/o-mne/), Portfolio (/portfolio/) and a framed Kontakt (home anchor); no Reference', () => {
    expect(items.map((i) => [i.label, i.href, i.anchor, Boolean(i.framed)])).toEqual([
      ['Úvod', '/', 'home', false],
      ['O mně', '/o-mne/', 'about', false],
      ['Portfolio', '/portfolio/', 'portfolio', false],
      ['Kontakt', '/#kontakt', 'kontakt', true],
    ]);
    expect(items.some((i) => /reference/i.test(i.href + i.label))).toBe(false);
  });

  it('has no category links', () => {
    expect(items.some((i) => /^\/(svatby|portrety|parove-foceni)\//.test(i.href))).toBe(false);
  });
});

describe('aria-current in the header nav', () => {
  it('marks only Úvod with "page" on the home page (scrollspy moves it in the browser)', () => {
    expect(marked('/')).toEqual(['home']);
    expect(navCurrent('/', items[0]!)).toBe('page');
  });

  it('never marks Úvod on other pages', () => {
    for (const path of ['/o-mne/', '/portfolio/', '/svatby/', '/cookies/', '/404/']) expect(marked(path)).not.toContain('home');
  });

  it('marks Portfolio with "true" on /portfolio/, a category page and an album page', () => {
    for (const path of ['/portfolio/', '/svatby/', '/svatby/sedlakovi/']) {
      expect(marked(path), path).toEqual(['portfolio']);
      expect(navCurrent(path, items[2]!)).toBe('true');
    }
  });

  it('marks O mně with "page" on /o-mne/ and nothing else there', () => {
    expect(marked('/o-mne/')).toEqual(['about']);
    expect(navCurrent('/o-mne/', items[1]!)).toBe('page');
    expect(isPortfolioPage('/o-mne/')).toBe(false);
  });

  it('marks nothing on cookies and 404', () => {
    for (const path of ['/cookies/', '/404/']) expect(marked(path), path).toEqual([]);
    expect(isPortfolioPage('/cookies/')).toBe(false);
  });

  it('uses "page" only for O mně on /o-mne/ and Úvod on /', () => {
    for (const path of ['/portfolio/', '/svatby/', '/svatby/sedlakovi/', '/cookies/']) {
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

  it('scrollspy only marks links to home anchors, so Portfolio (/portfolio/) is never "location" on the home (T-296)', () => {
    const spy = readFileSync(new URL('../scripts/scrollspy.ts', import.meta.url), 'utf8');
    expect(spy).toContain('[data-nav-anchor][href^="/#"]');
    expect(spy).toContain('[data-nav-anchor][href="/"]');
    expect(items.find((i) => i.anchor === 'portfolio')!.href.startsWith('/#')).toBe(false);
    expect(items.filter((i) => i.href.startsWith('/#')).map((i) => i.anchor)).toEqual(['kontakt']);
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
