import { describe, expect, it } from 'vitest';
import { ariaCurrent, isSection } from './nav';

const links = ['/portfolio/', '/svatby/', '/portrety/', '/parove-foceni/', '/o-mne/', '/kontakt/'];

describe('header nav state', () => {
  it('marks aria-current on exactly the matching link', () => {
    for (const current of links) {
      const marked = links.filter((p) => ariaCurrent(current, p) === 'page');
      expect(marked).toEqual([current]);
    }
  });

  it('marks nothing on the home page and marks the logo link there', () => {
    expect(links.filter((p) => ariaCurrent('/', p))).toEqual([]);
    expect(ariaCurrent('/', '/')).toBe('page');
  });

  it('on an album page the category is a section marker, not aria-current', () => {
    expect(ariaCurrent('/svatby/sedlakovi/', '/svatby/')).toBeUndefined();
    expect(isSection('/svatby/sedlakovi/', '/svatby/')).toBe(true);
    expect(isSection('/svatby/', '/svatby/')).toBe(false);
    expect(isSection('/svatby/sedlakovi/', '/')).toBe(false);
  });
});

describe('Header.astro wiring', () => {
  it('uses the nav helpers for aria-current', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../components/Header.astro', import.meta.url), 'utf8');
    expect(src).toContain('aria-current={ariaCurrent(current, item.path)}');
  });
});
