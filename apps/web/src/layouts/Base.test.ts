import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SnapshotSchema } from '@mp/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fixtureJson from '../../../../packages/shared/fixtures/snapshot.fixture.json';
import { portfolioMeta } from '../lib/seo';
import { checkWeight, measureFirstLoad, snapshotImageBytes } from '../lib/weight';

// Builds the real site into a temp dir (fixture mode) and checks the shell of the home page.
const webRoot = new URL('../..', import.meta.url).pathname;
const fixture = SnapshotSchema.parse(fixtureJson);
let out = '';
let html = '';

beforeAll(() => {
  out = mkdtempSync(join(tmpdir(), 'mp-web-'));
  execFileSync('npx', ['astro', 'build', '--outDir', out], {
    cwd: webRoot,
    env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1', PUBLIC_SITE_ENV: '', PUBLIC_SNAPSHOT_URL: '' },
    stdio: 'pipe',
  });
  html = readFileSync(join(out, 'index.html'), 'utf8');
  for (const c of fixture.categories) categoryHtml[c.slug] = readFileSync(join(out, c.slug, 'index.html'), 'utf8');
}, 180_000);

afterAll(() => {
  if (out) rmSync(out, { recursive: true, force: true });
});

const count = (re: RegExp): number => [...html.matchAll(re)].length;

/** Astro prints an empty alt attribute as a bare `alt`. */
const EMPTY_ALT = /\salt(?:="")?[\s>]/;
const categoryHtml: Record<string, string> = {};
const imgTags = (page: string): string[] => [...page.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
/** HTML of the section whose opening tag contains `marker`. */
const section = (marker: string): string => {
  const start = html.indexOf(marker);
  expect(start, marker).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf('</section>', start));
};
const jsonLdTypes = (): string[] =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
    (m) => (JSON.parse(m[1]!) as { '@type': string })['@type'],
  );

describe('Home page (built, shared build)', () => {
  it('has one h1 and an eager hero as the only fetchpriority=high image', () => {
    expect(count(/<h1[\s>]/g)).toBe(1);
    const imgs = [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
    const high = imgs.filter((t) => /fetchpriority="high"/.test(t));
    expect(high).toHaveLength(1);
    expect(high[0]).toContain('loading="eager"');
    expect(count(/fetchpriority="high"/g)).toBe(1);
    expect(high[0]).toMatch(/\balt="[^"]+"/);
  });

  it('links the three fixture categories from #kategorie with their 480 cover', () => {
    const cats = section('id="kategorie"');
    const hrefs = [...cats.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual(fixture.categories.map((c) => `/${c.slug}/`));
    for (const c of fixture.categories) {
      const album = c.albums[0]!;
      const cover = album.photos.find((p) => p.id === album.coverPhotoId) ?? album.photos[0]!;
      expect(cats).toContain(`${cover.id}/480.webp 480w`);
    }
    // The link text names the card, so its image is decorative.
    const imgs = imgTags(cats);
    expect(imgs).toHaveLength(fixture.categories.length);
    for (const tag of imgs) expect(tag).toMatch(EMPTY_ALT);
  });

  it('shows the pati and anez review images and no other eager image', () => {
    const reviews = section('<section class="reviews');
    const cover = (slug: string): string => {
      const album = fixture.categories.flatMap((c) => c.albums).find((a) => a.slug === slug)!;
      return album.coverPhotoId!;
    };
    expect(reviews).toContain(`${cover('pati')}/480.webp`);
    expect(reviews).toContain(`${cover('anez')}/480.webp`);
    expect(reviews).not.toContain('loading="eager"');
  });

  it('passes an absolute og:image', () => {
    expect(html).toMatch(/<meta property="og:image" content="https:\/\/www\.mullnyphotos\.cz\/[^"]+">/);
  });

  it('emits Photographer and WebSite JSON-LD only, no Review', () => {
    expect(jsonLdTypes().sort()).toEqual(['Photographer', 'WebSite']);
    expect(html).not.toMatch(/"@type":"(Review|AggregateRating)"/);
  });
});

describe('Category pages (built, shared build)', () => {
  const albumHrefs = (page: string, slug: string): string[] =>
    [...page.matchAll(new RegExp(`<a href="(/${slug}/[^"/]+/)"`, 'g'))].map((m) => m[1]!);

  it('builds one page per fixture category and lists its albums in sort order', () => {
    expect(Object.keys(categoryHtml)).toEqual(['svatby', 'portrety', 'parove-foceni']);
    const expected = { svatby: 4, portrety: 6, 'parove-foceni': 3 } as Record<string, number>;
    for (const c of fixture.categories) {
      expect(albumHrefs(categoryHtml[c.slug]!, c.slug)).toEqual(c.albums.map((a) => `/${c.slug}/${a.slug}/`));
      expect(c.albums).toHaveLength(expected[c.slug]!);
    }
  });

  it('has one h1, a breadcrumb, canonical, and ImageGallery plus BreadcrumbList JSON-LD', () => {
    for (const c of fixture.categories) {
      const page = categoryHtml[c.slug]!;
      expect([...page.matchAll(/<h1[\s>]/g)]).toHaveLength(1);
      expect(page).toContain('<nav class="breadcrumb"');
      expect(page).toMatch(/<li[^>]*aria-current="page"[^>]*>/);
      expect(page).toContain(`<link rel="canonical" href="https://www.mullnyphotos.cz/${c.slug}/">`);
      const types = [...page.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
        (m) => (JSON.parse(m[1]!) as { '@type': string })['@type'],
      );
      expect(types).toEqual(['ImageGallery', 'BreadcrumbList']);
      expect(page).not.toMatch(/"@type":"(Review|AggregateRating)"/);
    }
  });

  it('shows the count with a plural, cover 480 and 960 srcset, first row eager, first card high priority, rest lazy', () => {
    const page = categoryHtml['portrety']!;
    const imgs = imgTags(page).filter((t) => t.includes('/photos/'));
    expect(imgs).toHaveLength(6);
    expect(imgs.map((t) => /loading="(\w+)"/.exec(t)?.[1])).toEqual(['eager', 'eager', 'eager', 'lazy', 'lazy', 'lazy']);
    expect(imgs.filter((t) => t.includes('fetchpriority="high"'))).toHaveLength(1);
    expect(imgs[0]).toContain('fetchpriority="high"');
    for (const t of imgs) {
      expect(t).toMatch(/\swidth="\d+"/);
      expect(t).toMatch(/\sheight="\d+"/);
      expect(t).toMatch(EMPTY_ALT);
    }
    expect(page).toContain('480.webp 480w');
    expect(page).toContain('960.webp 960w');
    expect(page).toContain('(min-width: 48rem) 33vw, 100vw');
    expect(page).toMatch(/\d+ fotografi(e|í)/);
  });

  it('marks the category link in the header with aria-current=page', () => {
    for (const c of fixture.categories) {
      const nav = /<nav aria-label="Hlavní navigace"[^>]*>([\s\S]*?)<\/nav>/.exec(categoryHtml[c.slug]!)?.[1] ?? '';
      const current = [...nav.matchAll(/<a href="([^"]+)"[^>]*aria-current="page"/g)].map((m) => m[1]);
      expect(current).toEqual([`/${c.slug}/`]);
    }
    // The home page has no current nav link (its logo is the current page).
    const homeNav = /<nav aria-label="Hlavní navigace"[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? '';
    expect(homeNav).not.toContain('aria-current');
  });

  it('keeps the first load of every category page under the budget', () => {
    const imageBytes = snapshotImageBytes(fixture);
    for (const c of fixture.categories) {
      const w = measureFirstLoad({ distDir: out, page: `/${c.slug}/`, imageBytes });
      expect(checkWeight(w), `${c.slug}: ${JSON.stringify(w)}`).toEqual([]);
      expect(w.images).toBeGreaterThan(0);
    }
  });
});

describe('Portfolio page (built, shared build)', () => {
  it('has meta from portfolioMeta, one h1, a breadcrumb and BreadcrumbList JSON-LD', () => {
    const page = readFileSync(join(out, 'portfolio', 'index.html'), 'utf8');
    const m = portfolioMeta();
    expect(page).toContain(`<title>${m.title}</title>`);
    expect(page).toContain(`<meta name="description" content="${m.description}">`);
    expect([...page.matchAll(/<h1[\s>]/g)]).toHaveLength(1);
    expect(page).toContain('<nav class="breadcrumb"');
    expect(page).toContain('<link rel="canonical" href="https://www.mullnyphotos.cz/portfolio/">');
    const types = [...page.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
      (x) => (JSON.parse(x[1]!) as { '@type': string })['@type'],
    );
    expect(types).toEqual(['BreadcrumbList']);
  });

  it('links every category and a selection of albums that resolve to built pages', () => {
    const page = readFileSync(join(out, 'portfolio', 'index.html'), 'utf8');
    const main = page.slice(page.indexOf('<main'), page.indexOf('</main>'));
    const hrefs = [...main.matchAll(/<a href="(\/[^"]+\/)"/g)].map((x) => x[1]!);
    for (const c of fixture.categories) expect(hrefs).toContain(`/${c.slug}/`);
    const albumLinks = hrefs.filter((h) => h.split('/').length === 4);
    expect(albumLinks).toHaveLength(9);
    const known = fixture.categories.flatMap((c) => c.albums.map((a) => `/${c.slug}/${a.slug}/`));
    for (const h of albumLinks) expect(known, h).toContain(h);
    // Album pages are a later task (the [category]/[album] route); once it exists they must be built too.
    const albumRoute = (f: string): boolean => existsSync(new URL(`../pages/[category]/${f}`, import.meta.url).pathname);
    if (albumRoute('[album]') || albumRoute('[album].astro')) {
      for (const h of albumLinks) expect(existsSync(join(out, h, 'index.html')), h).toBe(true);
    }
  });

  it('marks Portfolio as the current nav link', () => {
    const page = readFileSync(join(out, 'portfolio', 'index.html'), 'utf8');
    const nav = /<nav aria-label="Hlavní navigace"[^>]*>([\s\S]*?)<\/nav>/.exec(page)?.[1] ?? '';
    const current = [...nav.matchAll(/<a href="([^"]+)"[^>]*aria-current="page"/g)].map((x) => x[1]);
    expect(current).toEqual(['/portfolio/']);
  });
});

describe('Base layout (built home page)', () => {
  it('is Czech with exactly one main landmark and one h1', () => {
    expect(html).toContain('<html lang="cs">');
    expect(count(/<main[\s>]/g)).toBe(1);
    expect(count(/<h1[\s>]/g)).toBe(1);
  });

  it('puts the skip link first in the tab order and targets main', () => {
    const body = html.slice(html.indexOf('<body>'));
    const firstFocusable = /<(a|button|summary|input|select|textarea)[\s>]/.exec(body);
    expect(firstFocusable?.[1]).toBe('a');
    expect(body).toMatch(/^<body><a class="skip-link" href="#obsah">/);
    expect(html).toContain('<main id="obsah"');
  });

  it('has six header nav links and marks the current page', () => {
    const nav = /<nav aria-label="Hlavní navigace"[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? '';
    const hrefs = [...nav.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual(['/portfolio/', '/svatby/', '/portrety/', '/parove-foceni/', '/o-mne/', '/kontakt/']);
    // On the home page the logo link is the current page.
    expect(html).toMatch(/class="logo" href="\/"[^>]*aria-current="page"/);
  });

  it('uses a native details disclosure for the menu', () => {
    expect(html).toMatch(/<details class="menu" data-menu[^>]*><summary/);
  });

  it('carries canonical, robots, Open Graph and Twitter tags', () => {
    expect(html).toContain('<link rel="canonical" href="https://www.mullnyphotos.cz/">');
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    for (const tag of ['og:title', 'og:description', 'og:url', 'og:locale', 'og:site_name', 'og:type']) {
      expect(html).toContain(`property="${tag}"`);
    }
    for (const tag of ['twitter:card', 'twitter:title', 'twitter:description']) {
      expect(html).toContain(`name="${tag}"`);
    }
  });

  it('has no href="#" and loads nothing from a third-party host', () => {
    expect(html).not.toMatch(/href="#"/);
    const tags = [...html.matchAll(/<(?:link|script|img|source|iframe)\b[^>]*>/g)].map((m) => m[0]);
    const external = tags.filter(
      (t) => !t.includes('rel="canonical"') && /\b(?:src|href|srcset)="(?:https?:)?\/\//.test(t),
    );
    expect(external).toEqual([]);
  });
});
