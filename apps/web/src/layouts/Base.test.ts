import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { SnapshotSchema } from '@mp/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fixtureJson from '../../../../packages/shared/fixtures/snapshot.fixture.json';
import { HASH_REDIRECT_SCRIPT } from '../lib/hash-redirect';
import { aboutMeta, contactMeta, portfolioMeta } from '../lib/seo';
import { checkWeight, measureFirstLoad, snapshotImageBytes } from '../lib/weight';

// Builds the real site into a temp dir (fixture mode) and checks the shell of the home page.
const webRoot = new URL('../..', import.meta.url).pathname;
const fixture = SnapshotSchema.parse(fixtureJson);
let out = '';
let html = '';

beforeAll(() => {
  // Astro keeps its scratch state in apps/web/.astro (types, .prerender) and offers no CLI flag or config key to move it
  // (cacheDir only moves the Vite cache), so --outDir does not isolate this build. Never run another `astro build` in
  // apps/web (npm run build, design-check) while this test runs; see docs/DESIGN-CHECK.md "Not done / limits".
  out =mkdtempSync(join(tmpdir(), 'mp-web-'));
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
    expect(page).toContain('(min-width: 48rem) min((100vw - 7rem) / 3, 24.5rem), calc(100vw - 2rem)');
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

describe('Album pages (built, shared build)', () => {
  const albums = fixture.categories.flatMap((c) => c.albums.map((a) => ({ c, a })));
  const read = (c: string, a: string): string => readFileSync(join(out, c, a, 'index.html'), 'utf8');

  it('builds all 13 album pages with one h1, breadcrumb, canonical, ImageGallery and BreadcrumbList', () => {
    expect(albums).toHaveLength(13);
    for (const { c, a } of albums) {
      const page = read(c.slug, a.slug);
      expect([...page.matchAll(/<h1[\s>]/g)], a.slug).toHaveLength(1);
      expect(page).toContain('<nav class="breadcrumb"');
      expect(page).toContain(`<link rel="canonical" href="https://www.mullnyphotos.cz/${c.slug}/${a.slug}/">`);
      const types = [...page.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
        (m) => (JSON.parse(m[1]!) as { '@type': string })['@type'],
      );
      expect(types).toEqual(['ImageGallery', 'BreadcrumbList']);
      expect(page).toContain('<dialog');
      expect(page).toContain('data-lightbox');
    }
  });

  it('sedlakovi: 44 photos with real alt, dimensions, first photo eager, rest lazy, links to the 1600 JPEG', () => {
    const page = read('svatby', 'sedlakovi');
    const grid = page.slice(page.indexOf('<ul class="grid'), page.indexOf('</ul>', page.indexOf('<ul class="grid')));
    const imgs = imgTags(grid);
    expect(imgs).toHaveLength(44);
    expect(imgs.map((t) => /loading="(\w+)"/.exec(t)?.[1])).toEqual(
      imgs.map((_, i) => (i === 0 ? 'eager' : 'lazy')),
    );
    for (const t of imgs) {
      const alt = /\salt="([^"]+)"/.exec(t)?.[1];
      expect(alt, t).toBeTruthy();
      expect(alt).not.toMatch(/\.(jpe?g|webp|png)$/i);
      expect(t).toMatch(/\swidth="\d+"/);
      expect(t).toMatch(/\sheight="\d+"/);
    }
    expect(imgs[11]).toMatch(/alt="[^"]*fotografie 12 z 44"/);
    const hrefs = [...grid.matchAll(/<a href="([^"]+)" data-lb-item/g)].map((m) => m[1]!);
    expect(hrefs).toHaveLength(44);
    for (const h of hrefs) expect(h).toMatch(/\/1600\.jpg$/);
  });

  it('has previous and next album links within the category', () => {
    const page = read('svatby', 'sedlakovi');
    const list = fixture.categories.find((c) => c.slug === 'svatby')!.albums.map((a) => a.slug);
    const i = list.indexOf('sedlakovi');
    if (i > 0) expect(page).toContain(`rel="prev" href="/svatby/${list[i - 1]}/"`);
    if (i < list.length - 1) expect(page).toContain(`rel="next" href="/svatby/${list[i + 1]}/"`);
  });

  // 6 KB: staged loading, zoom and pointer gestures (WP-03b); the page JS budget in site-checks is 60 KB in total.
  it('ships the lightbox script under 6 KB gzip, with no inline handlers', () => {
    const page = read('svatby', 'sedlakovi');
    expect(page).not.toMatch(/\son(click|keydown|load|error)=/);
    const dir = join(out, '_astro');
    const js = readdirSync(dir).filter((f) => f.endsWith('.js'));
    const lightboxFiles = js.filter((f) => readFileSync(join(dir, f), 'utf8').includes('data-lb-item'));
    expect(lightboxFiles.length).toBeGreaterThan(0);
    for (const f of lightboxFiles) {
      const bytes = gzipSync(readFileSync(join(dir, f))).length;
      expect(bytes, f).toBeLessThan(6 * 1024);
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

describe('About and Contact pages (built, shared build)', () => {
  const read = (dir: string): string => readFileSync(join(out, dir, 'index.html'), 'utf8');
  const ldBlocks = (page: string): Array<Record<string, unknown>> =>
    [...page.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
      (x) => JSON.parse(x[1]!) as Record<string, unknown>,
    );
  const pages = [
    { dir: 'o-mne', path: '/o-mne/', m: aboutMeta(), types: ['Person', 'BreadcrumbList'] },
    { dir: 'kontakt', path: '/kontakt/', m: contactMeta(), types: ['Photographer', 'BreadcrumbList'] },
  ];

  it('has SEO pattern title and description, one h1, breadcrumb, canonical and the expected JSON-LD', () => {
    for (const { dir, path, m, types } of pages) {
      const page = read(dir);
      expect(page).toContain(`<title>${m.title}</title>`);
      expect(page).toContain(`<meta name="description" content="${m.description}">`);
      expect([...page.matchAll(/<h1[\s>]/g)], dir).toHaveLength(1);
      expect(page).toContain('<nav class="breadcrumb"');
      expect(page).toContain(`<link rel="canonical" href="https://www.mullnyphotos.cz${path}">`);
      expect(ldBlocks(page).map((b) => b['@type'])).toEqual(types);
      expect(page).not.toMatch(/"@type":"(Review|AggregateRating)"/);
    }
  });

  it('has the hero as the only fetchpriority=high image and real alt text on every image', () => {
    for (const { dir } of pages) {
      const page = read(dir);
      const imgs = imgTags(page.slice(page.indexOf('<main'), page.indexOf('</main>')));
      const high = imgs.filter((t) => t.includes('fetchpriority="high"'));
      expect(high, dir).toHaveLength(1);
      expect(high[0]).toContain('loading="eager"');
      expect([...page.matchAll(/fetchpriority="high"/g)]).toHaveLength(1);
      for (const t of imgs) {
        if (!/\salt="[^"]+"/.test(t)) {
          expect(t).toMatch(EMPTY_ALT);
          continue;
        }
        expect(/\salt="([^"]+)"/.exec(t)?.[1]).not.toMatch(/\.(jpe?g|webp|png)$/i);
      }
      // The Instagram icon is the only decorative image; every other one has text.
      expect(imgs.filter((t) => !/\salt="[^"]+"/.test(t)).length).toBeLessThanOrEqual(1);
    }
  });

  it('Contact has a working mailto and an Instagram link with rel, and no form', () => {
    const page = read('kontakt');
    expect(page).toContain('href="mailto:mullnyphotos@gmail.com"');
    const main = page.slice(page.indexOf('<main'), page.indexOf('</main>'));
    const ig = [...main.matchAll(/<a\b[^>]*href="https:\/\/www\.instagram\.com\/[^"]*"[^>]*>/g)].map((x) => x[0]);
    expect(ig).toHaveLength(1);
    expect(ig[0]).toContain('rel="noopener noreferrer"');
    expect(page).not.toMatch(/<form[\s>]/);
    expect(read('o-mne')).not.toMatch(/<form[\s>]/);
  });

  it('About emits Person referencing #business; Contact emits the full Photographer', () => {
    const person = ldBlocks(read('o-mne'))[0]!;
    expect(person['@type']).toBe('Person');
    expect(person['worksFor']).toEqual({ '@id': 'https://www.mullnyphotos.cz/#business' });
    const photographer = ldBlocks(read('kontakt'))[0]!;
    expect(photographer['@id']).toBe('https://www.mullnyphotos.cz/#business');
    expect(photographer['email']).toBe('mullnyphotos@gmail.com');
  });

  it('has an absolute 1200x630 og:image under 300 KB', () => {
    for (const { dir } of pages) {
      const page = read(dir);
      const url = /<meta property="og:image" content="(https:\/\/www\.mullnyphotos\.cz\/[^"]+)">/.exec(page)?.[1];
      expect(url, dir).toBeTruthy();
      expect(page).toContain('<meta property="og:image:width" content="1200">');
      expect(page).toContain('<meta property="og:image:height" content="630">');
      const file = join(out, new URL(url!).pathname);
      expect(existsSync(file), file).toBe(true);
      const buf = readFileSync(file);
      expect(buf.length).toBeLessThan(300 * 1024);
      // JPEG SOF0/SOF2 marker carries the pixel size.
      let w = 0;
      let h = 0;
      for (let i = 2; i < buf.length - 9; ) {
        if (buf[i] !== 0xff) break;
        const marker = buf[i + 1]!;
        if (marker === 0xc0 || marker === 0xc2) {
          h = buf.readUInt16BE(i + 5);
          w = buf.readUInt16BE(i + 7);
          break;
        }
        i += 2 + buf.readUInt16BE(i + 2);
      }
      expect([w, h]).toEqual([1200, 630]);
    }
  });

  it('marks About and Contact as the current nav link', () => {
    for (const { dir, path } of pages) {
      const nav = /<nav aria-label="Hlavní navigace"[^>]*>([\s\S]*?)<\/nav>/.exec(read(dir))?.[1] ?? '';
      const current = [...nav.matchAll(/<a href="([^"]+)"[^>]*aria-current="page"/g)].map((x) => x[1]);
      expect(current).toEqual([path]);
    }
  });
});

describe('Cookies page and 404 (built, shared build)', () => {
  const cookies = (): string => readFileSync(join(out, 'cookies', 'index.html'), 'utf8');

  it('/cookies/ has the title, canonical, one h1, breadcrumb and BreadcrumbList', () => {
    const page = cookies();
    expect(page).toContain('<title>Zásady cookies a ochrany soukromí | Mullny Photos</title>');
    expect(page).toContain('<link rel="canonical" href="https://www.mullnyphotos.cz/cookies/">');
    expect([...page.matchAll(/<h1[\s>]/g)]).toHaveLength(1);
    expect(page).toContain('<nav class="breadcrumb"');
    expect(page).toContain('"@type":"BreadcrumbList"');
  });

  it('/cookies/ implies no banner, claims nothing about analytics, and has [doplnit] markers and the slot', () => {
    const page = cookies();
    const main = page.slice(page.indexOf('<main'), page.indexOf('</main>'));
    // The HTML comment that marks the WP-7 slot names ANALYTICS_PARAGRAPH; only visible text is checked.
    expect(main.replace(/<!--[\s\S]*?-->/g, '')).not.toMatch(/cookiebar|souhlas|analytic|google analytics|měření/i);
    expect((main.match(/\[doplnit\]/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(page).toContain('ANALYTICS_PARAGRAPH');
    expect(main).toContain('href="mailto:mullnyphotos@gmail.com"');
    expect(main).toContain('href="https://uoou.gov.cz"');
    expect(main).toContain('Cloudflare');
    expect(main).not.toMatch(/\bEU\b|Evropsk/);
  });

  it('dist/404.html exists, is noindex, and links to / and the three categories', () => {
    const file = join(out, '404.html');
    expect(existsSync(file)).toBe(true);
    const page = readFileSync(file, 'utf8');
    expect(page).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(page).toContain('<title>Stránka nenalezena | Mullny Photos</title>');
    const main = page.slice(page.indexOf('<main'), page.indexOf('</main>'));
    const hrefs = [...main.matchAll(/<a href="([^"]+)"/g)].map((x) => x[1]);
    expect(hrefs).toEqual(['/', ...fixture.categories.map((c) => `/${c.slug}/`)]);
  });
});

describe('Sitemap and robots (built, shared build)', () => {
  it('sitemap.xml lists the 21 fixture URLs (1 + 1 + 3 + 13 + 3), without 404, and sedlakovi has 44 images', () => {
    const xml = readFileSync(join(out, 'sitemap.xml'), 'utf8');
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    const albums = fixture.categories.flatMap((c) => c.albums.map((a) => `/${c.slug}/${a.slug}/`));
    const expected = [
      '/',
      '/portfolio/',
      ...fixture.categories.map((c) => `/${c.slug}/`),
      ...albums,
      '/o-mne/',
      '/kontakt/',
      '/cookies/',
    ].map((p) => `https://www.mullnyphotos.cz${p}`);
    expect(locs).toHaveLength(21);
    expect([...locs].sort()).toEqual([...expected].sort());
    expect(locs.filter((l) => /404/.test(l!))).toEqual([]);
    const sedlakovi = xml.slice(xml.indexOf('/svatby/sedlakovi/</loc>'));
    expect([...sedlakovi.slice(0, sedlakovi.indexOf('</url>')).matchAll(/<image:image>/g)]).toHaveLength(44);
    expect([...xml.matchAll(/<lastmod>/g)]).toHaveLength(fixture.categories.length + albums.length);
  });

  it('robots.txt of the non-production build disallows everything', () => {
    const robots = readFileSync(join(out, 'robots.txt'), 'utf8');
    expect(robots).toContain('Disallow: /');
    expect(robots).not.toContain('Sitemap:');
  });
});

describe('Icons and manifest (built, shared build)', () => {
  /** PNG IHDR: width and height at bytes 16 and 20, after the 8-byte signature. */
  const pngSize = (file: string): [number, number] => {
    const buf = readFileSync(join(out, file));
    expect(buf.subarray(1, 4).toString('latin1'), file).toBe('PNG');
    return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
  };

  it('ships the icons at the declared pixel sizes', () => {
    expect(pngSize('apple-touch-icon.png')).toEqual([180, 180]);
    expect(pngSize('icon-192.png')).toEqual([192, 192]);
    expect(pngSize('icon-512.png')).toEqual([512, 512]);
    expect(pngSize('android-chrome-192x192.png')).toEqual([192, 192]);
    expect(pngSize('logo.png')).toEqual([512, 512]);
    expect(readFileSync(join(out, 'android-chrome-192x192.png')).equals(readFileSync(join(out, 'icon-192.png')))).toBe(true);
    expect(readFileSync(join(out, 'logo.png')).equals(readFileSync(join(out, 'icon-512.png')))).toBe(true);
    expect(existsSync(join(out, 'favicon.ico'))).toBe(true);
  });

  it('has a Czech manifest whose icons exist at their declared sizes', () => {
    const m = JSON.parse(readFileSync(join(out, 'manifest.webmanifest'), 'utf8')) as {
      name: string;
      lang: string;
      theme_color: string;
      icons: Array<{ src: string; sizes: string }>;
    };
    expect(m.name).toBe('Mullny Photos');
    expect(m.lang).toBe('cs');
    const theme = /--color-theme:\s*([^;]+);/.exec(readFileSync(join(webRoot, 'src/styles/tokens.css'), 'utf8'))?.[1]?.trim();
    expect(m.theme_color).toBe(theme);
    expect(m.icons.map((i) => i.sizes)).toEqual(['192x192', '512x512']);
    for (const i of m.icons) {
      const [w, h] = pngSize(i.src.slice(1));
      expect(`${w}x${h}`).toBe(i.sizes);
    }
  });

  it('links the 180 px PNG as apple-touch-icon, not the .ico, and the manifest from the home head', () => {
    expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180">');
    expect(html).not.toMatch(/rel="apple-touch-icon"[^>]*\.ico/);
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest">');
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

  it('inlines the identical hash-redirect script in the home head, and only there', () => {
    const head = html.slice(0, html.indexOf('</head>'));
    expect(head).toContain(`<script>${HASH_REDIRECT_SCRIPT}</script>`);
    expect(count(/<script>\(function\(\)\{var h=location\.hash/g)).toBe(1);
    const category = categoryHtml['svatby']!;
    expect(category).not.toContain('location.hash');
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
