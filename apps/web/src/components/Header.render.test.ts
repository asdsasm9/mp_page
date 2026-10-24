import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import { NAV } from '../content/texts';
import { buildNav } from '../lib/nav';
import Header from './Header.astro';

const items = buildNav(NAV);
const categoryNames = ['Svatby', 'Portréty', 'Párové focení'];

async function render(current: string, overHero = false, nav = items): Promise<string> {
  const container = await AstroContainer.create();
  return container.renderToString(Header, { props: { items: nav, current, categoryNames, overHero } });
}

/** The header with Astro's scoped-style ids removed, so pages can be compared. */
const plain = (html: string): string => html.replace(/\sdata-astro-cid-[a-z0-9]+(="")?/g, '');
const header = (html: string): string => /<header[\s\S]*<\/header>/.exec(html)?.[0] ?? '';

describe('Header.astro', () => {
  it('has one wordmark link home, one desktop nav and one details drawer with a summary', async () => {
    const html = header(plain(await render('/')));
    expect(html.match(/class="wordmark t-wordmark"/g)).toHaveLength(1);
    expect(html.match(/<nav class="nav-desk" aria-label="Hlavní navigace"/g)).toHaveLength(1);
    expect(html.match(/<details class="menu" data-menu>\s*<summary/g)).toHaveLength(1);
    expect(html.match(/<nav /g)).toHaveLength(2);
    expect(html).toContain('aria-label="Hlavní navigace v menu"');
  });

  it('names the wordmark "MullnyPhotos – úvodní stránka", containing the visible label', async () => {
    const html = header(await render('/'));
    const text = /class="wordmark t-wordmark"[^>]*>([\s\S]*?)<\/a>/.exec(html)?.[1]?.replace(/<[^>]+>/g, '') ?? '';
    expect(text.replace(/\s+/g, ' ').trim()).toBe('MullnyPhotos – úvodní stránka');
    expect(text.startsWith(NAV.wordmark)).toBe(true);
  });

  it('lists Úvod first, then O mně, Portfolio and a framed Kontakt in both navs, wordmark separate', async () => {
    const html = header(plain(await render('/')));
    const hrefs = [...html.matchAll(/<a [^>]*href="(\/[^"]*)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual(['/', '/', '/o-mne/', '/portfolio/', '/#kontakt', '/', '/o-mne/', '/portfolio/', '/#kontakt']);
    expect(html.match(/data-framed/g)).toHaveLength(2);
    expect(html.match(/>\s*Úvod\s*</g)).toHaveLength(2);
  });

  it('has no Reference item in either nav', async () => {
    const html = await render('/');
    expect(html).not.toContain('/#reference');
    expect(html).not.toContain('Reference');
  });

  it('shows the category names as plain text at the bottom of the drawer', async () => {
    const html = await render('/');
    expect(html).toContain('Svatby · Portréty · Párové focení');
  });

  it('sets data-over-hero only when the prop is set', async () => {
    expect(header(await render('/', true))).toMatch(/<header class="site-header" data-over-hero(="")?[ >]/);
    expect(header(await render('/', false))).not.toContain('data-over-hero');
  });

  it('is identical on home, category and album pages except data-over-hero and aria-current', async () => {
    const strip = (h: string): string =>
      plain(h).replace(/ data-over-hero(="")?/g, '').replace(/ aria-current="[a-z]+"/g, '');
    const home = strip(header(await render('/', true)));
    expect(strip(header(await render('/svatby/')))).toBe(home);
    expect(strip(header(await render('/svatby/sedlakovi/')))).toBe(home);
  });

  it('marks Portfolio with aria-current="true" on category and album pages, nothing on home', async () => {
    for (const path of ['/svatby/', '/svatby/sedlakovi/']) {
      const html = header(plain(await render(path)));
      expect(html.match(/aria-current="true"/g), path).toHaveLength(2); // desktop nav and drawer
      expect(html).not.toMatch(/aria-current="page"/);
    }
    const home = header(plain(await render('/', true)));
    expect(home).not.toContain('aria-current="true"');
    // wordmark plus Úvod in the desktop nav and in the drawer
    expect(home.match(/aria-current="page"/g)).toHaveLength(3);
    for (const m of home.matchAll(/<a [^>]*class="t-nav"[^>]*aria-current="page"[^>]*>/g)) expect(m[0]).toContain('href="/"');
  });

  it('marks O mně with aria-current="page" in both navs on /o-mne/ and nowhere else', async () => {
    const html = header(plain(await render('/o-mne/')));
    expect(html.match(/aria-current="page"/g)).toHaveLength(2);
    expect(html).not.toContain('aria-current="true"');
    for (const m of html.matchAll(/<a [^>]*aria-current="page"[^>]*>/g)) expect(m[0]).toContain('href="/o-mne/"');
    expect(header(plain(await render('/cookies/')))).not.toContain('aria-current="page"');
  });

  it('puts no inline style, no href="#" and no click-only controls in the header', async () => {
    const html = header(await render('/'));
    expect(html).not.toContain('style="');
    expect(html).not.toContain('href="#"');
    expect(html).not.toMatch(/<(div|span)[^>]*onclick/);
  });
});
