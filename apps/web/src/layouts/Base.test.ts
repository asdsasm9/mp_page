import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { SnapshotSchema } from '@mp/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fixtureJson from '../../../../packages/shared/fixtures/snapshot.fixture.json';
import { REVIEWS } from '../content/reviews';
import { ABOUT, HOME } from '../content/texts';
import { HASH_REDIRECT_SCRIPT } from '../lib/hash-redirect';
import { portfolioMeta } from '../lib/seo';
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
/** The anchor tags of the desktop header nav of a built page. */
const navLinks = (page: string): string[] => {
  const nav = /<nav class="nav-desk" aria-label="Hlavní navigace"[^>]*>([\s\S]*?)<\/nav>/.exec(page)?.[1] ?? '';
  return [...nav.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);
};
const hrefOf = (tag: string): string => /href="([^"]+)"/.exec(tag)?.[1] ?? '';
const currentLinks = (page: string): string[] => navLinks(page).filter((t) => /aria-current/.test(t)).map(hrefOf);
/** The header element of a built page without Astro's scoped-style ids. */
const headerOf = (page: string): string =>
  (/<header class="site-header"[\s\S]*?<\/header>/.exec(page)?.[0] ?? '').replace(/\sdata-astro-cid-[a-z0-9]+(="")?/g, '');
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

  it('uses the hero photo chosen in the snapshot: every stored tier, 100vw, eager, high, its own og.jpg', () => {
    const id = fixture.heroPhotoId!;
    expect(id).toBeTruthy();
    const photo = fixture.categories.flatMap((c) => c.albums).flatMap((a) => a.photos).find((p) => p.id === id)!;
    const hero = section('class="hero"');
    const tag = imgTags(hero)[0]!;
    expect(tag).toContain('fetchpriority="high"');
    expect(tag).toContain('loading="eager"');
    expect(tag).toContain(`${id}/1600.jpg`);
    for (const v of photo.variants.webp) expect(hero).toContain(`${id}/${v.tier}.webp ${v.w}w`);
    expect(hero).toContain('sizes="100vw"');
    expect(hero).not.toContain('/_astro/main.'); // the bundled fallback is not rendered
    expect(html).toMatch(new RegExp(`<meta property="og:image" content="https://www\\.mullnyphotos\\.cz/[^"]*${id}/og\\.jpg">`));
  });

  it('links the three fixture categories from #portfolio with their 480 cover', () => {
    const cats = section('id="portfolio"');
    const hrefs = [...cats.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual(fixture.categories.map((c) => `/${c.slug}/`));
    for (const c of fixture.categories) {
      // The chosen category photo when there is one (the fixture has it on the first category), else the first album's cover.
      const album = c.albums[0]!;
      const coverId = c.coverPhotoId ?? album.coverPhotoId ?? album.photos[0]!.id;
      expect(cats).toContain(`${coverId}/480.webp 480w`);
      if (c.coverPhotoId !== null && album.coverPhotoId !== null) expect(cats).not.toContain(`${album.coverPhotoId}/`);
    }
    // The link text names the card, so its image is decorative.
    const imgs = imgTags(cats);
    expect(imgs).toHaveLength(fixture.categories.length);
    for (const tag of imgs) expect(tag).toMatch(EMPTY_ALT);
  });

  it('shows the short review text, the full text in a details "Celá recenze", no photos, in the dark band', () => {
    const reviews = section('id="reference"').replace(/\sdata-astro-cid-[a-z0-9]+(="")?/g, '');
    expect(reviews).toContain('data-band="dark"');
    expect(reviews).toContain('Reference');
    for (const r of REVIEWS) {
      expect(reviews).toContain(`<p>${r.short}</p>`);
      expect(reviews).toContain(r.text);
      expect(reviews).toContain(`${r.name} · `);
    }
    expect([...reviews.matchAll(/<details\b/g)]).toHaveLength(REVIEWS.length);
    expect(reviews).toContain('Celá recenze');
    expect(imgTags(reviews)).toHaveLength(0);
  });

  it('orders the sections uvod, o-mne, portfolio, reference, kontakt, with no quote section and no collage', () => {
    const marks = ['id="uvod"', 'id="o-mne"', 'id="portfolio"', 'id="reference"', 'id="kontakt"'];
    const at = marks.map((m) => html.indexOf(m));
    for (const [i, p] of at.entries()) expect(p, marks[i]).toBeGreaterThan(-1);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    for (const m of marks) expect(count(new RegExp(m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')), m).toBe(1);
    expect(html).not.toContain('class="collage"');
    expect(html).not.toContain('id="kategorie"');
    expect(html).not.toMatch(/class="button"/);
  });

  it('has the hero kicker with the category names, the h1 text and a button to #kontakt', () => {
    const hero = section('id="uvod"');
    expect(hero).toContain('Svatby · Portréty · Párové focení');
    expect(hero).toMatch(/<h1[^>]*>Focení svateb, portrétů a párových fotek<\/h1>/);
    expect(hero).toMatch(/<a class="btn"[^>]*href="#kontakt"[^>]*>Poptat termín<\/a>/);
  });

  it('O mně has the corrected alt texts, lazy images, the details with the long text and the quote, and a link to #kontakt', () => {
    const about = section('id="o-mne"');
    expect(about).toContain('alt="Ruce novomanželů s prsteny v pšeničném poli"');
    expect(about).not.toContain('Fotografka Terezie Müllnerová');
    const imgs = imgTags(about);
    expect(imgs).toHaveLength(2);
    for (const t of imgs) expect(t).toContain('loading="lazy"');
    expect(about).toContain(HOME.hello.paragraphs[0]!);
    expect(about).toMatch(/<details[^>]*class="more[^"]*"/);
    expect(about).toContain(ABOUT.experience.body);
    expect(about).toContain(HOME.quote);
    expect(about).toContain('href="#kontakt"');
  });

  it('Kontakt has the mailto button, Instagram and MyWed with rel and the new-window hint, and no form or tel link', () => {
    const contact = section('id="kontakt"');
    expect(contact).toContain('href="mailto:mullnyphotos@gmail.com"');
    for (const host of ['www.instagram.com', 'mywed.com']) {
      const tag = new RegExp(`<a\\b[^>]*href="https://${host.replace('.', '\\.')}[^"]*"[^>]*>`).exec(contact)?.[0];
      expect(tag, host).toContain('rel="noopener noreferrer"');
    }
    expect(contact).toContain('(otevře se v novém okně)');
    expect(contact).not.toMatch(/<form[\s>]|href="tel:/);
  });

  it('passes an absolute og:image', () => {
    expect(html).toMatch(/<meta property="og:image" content="https:\/\/www\.mullnyphotos\.cz\/[^"]+">/);
  });

  it('emits Photographer and WebSite JSON-LD only, no Review', () => {
    expect(jsonLdTypes().sort()).toEqual(['Person', 'Photographer', 'WebSite']);
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
    // Album covers are cropped into the 4/5 box: sizes is the box width times the crop factor (T-276, F10).
    expect(page).toMatch(/sizes="\(min-width: 48rem\) calc\(26rem \* [\d.]+\), calc\(\(100vw - 3rem\) \* [\d.]+\)"/);
    expect(page).toMatch(/\d+ fotografi(e|í)/);
  });

  it('marks Portfolio in the header with aria-current=true (never page), and the header equals the home header', () => {
    for (const c of fixture.categories) {
      const page = categoryHtml[c.slug]!;
      expect(currentLinks(page)).toEqual(['/#portfolio']);
      expect(navLinks(page).filter((t) => /aria-current="true"/.test(t))).toHaveLength(1);
      expect(page).not.toMatch(/<a [^>]*class="t-nav"[^>]*aria-current="page"/);
      // Same header markup as on the home page; only data-over-hero and aria-current differ.
      const norm = (h: string): string => h.replace(/ data-over-hero(="")?/g, '').replace(/ aria-current="[a-z]+"/g, '');
      expect(norm(headerOf(page))).toBe(norm(headerOf(html)));
    }
    // The home page marks no nav link on the server (scrollspy does it in the browser).
    expect(currentLinks(html)).toEqual([]);
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
    expect(currentLinks(page)).toEqual(['/#portfolio']);
  });
});

describe('Removed pages, footer and site-wide guards (built, shared build, T-281)', () => {
  const allHtml = (): Array<[string, string]> =>
    (readdirSync(out, { recursive: true }) as string[])
      .filter((f) => f.endsWith('.html'))
      .map((f): [string, string] => [f, readFileSync(join(out, f), 'utf8')]);

  it('does not build /o-mne/ and /kontakt/ any more', () => {
    expect(existsSync(join(out, 'o-mne'))).toBe(false);
    expect(existsSync(join(out, 'kontakt'))).toBe(false);
  });

  it('no built page has a tel: link, a +420 number or a telephone property', () => {
    const pages = allHtml();
    expect(pages.length).toBeGreaterThan(10);
    for (const [f, page] of pages) {
      expect(page, f).not.toMatch(/href="tel:/i);
      expect(page, f).not.toContain('+420');
      expect(page, f).not.toMatch(/"telephone"/i);
    }
  });

  it('no built page has placeholder text', () => {
    for (const [f, page] of allHtml()) {
      for (const needle of ['Jméno klienta', 'priklad.cz', 'Zde bude']) expect(page, `${f}: ${needle}`).not.toContain(needle);
    }
  });

  it('the footer has the hairline row: copyright, icon links without Facebook, category links, tagline and the legal link', () => {
    const footer = /<footer\b[\s\S]*?<\/footer>/.exec(html)?.[0] ?? '';
    expect(footer).toContain('© Mullny Photos');
    expect(footer).toContain('Fotím v Jihomoravském kraji');
    expect(footer).toContain('href="mailto:mullnyphotos@gmail.com"');
    expect(footer).toMatch(/href="https:\/\/www\.instagram\.com\/[^"]*"[^>]*rel="noopener noreferrer"|rel="noopener noreferrer"[^>]*href="https:\/\/www\.instagram\.com\//);
    expect(footer).toMatch(/href="https:\/\/mywed\.com[^"]*"/);
    expect(footer).toContain('href="/cookies/"');
    expect(footer).not.toMatch(/facebook/i);
    const nav = /<nav[^>]*aria-label="Kategorie"[^>]*>([\s\S]*?)<\/nav>/.exec(footer)?.[1] ?? '';
    const hrefs = [...nav.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual(fixture.categories.map((c) => `/${c.slug}/`));
  });

  it('the footer is present on the home page, a category page, /cookies/ and the 404', () => {
    for (const f of ['index.html', join(fixture.categories[0]!.slug, 'index.html'), join('cookies', 'index.html'), '404.html']) {
      expect(readFileSync(join(out, f), 'utf8'), f).toContain('class="site-footer');
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
    // The shared build is token-less: no marker comment, no analytics section.
    expect(main).not.toMatch(/cookiebar|souhlas|analytic|google analytics|měření/i);
    // Name and address are required; IČO is optional and its line is omitted while unset (T-220).
    expect((main.match(/\[doplnit\]/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(main).not.toContain('IČO');
    expect(page).not.toContain('ANALYTICS_PARAGRAPH');
    expect(page).not.toContain('id="mereni"');
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
    const hrefs = [...main.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map((x) => x[1]);
    // Breadcrumb "Úvod", the "Na úvodní stránku" button, then the category buttons.
    expect(hrefs).toEqual(['/', '/', ...fixture.categories.map((c) => `/${c.slug}/`)]);
    expect([...page.matchAll(/<h1[\s>]/g)]).toHaveLength(1);
    expect(page).toContain('<nav class="breadcrumb"');
  });
});

describe('Sitemap and robots (built, shared build)', () => {
  it('sitemap.xml lists the 19 fixture URLs (1 + 1 + 3 + 13 + 1), without 404 and without /o-mne/ and /kontakt/, and sedlakovi has 44 images', () => {
    const xml = readFileSync(join(out, 'sitemap.xml'), 'utf8');
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    const albums = fixture.categories.flatMap((c) => c.albums.map((a) => `/${c.slug}/${a.slug}/`));
    const expected = [
      '/',
      '/portfolio/',
      ...fixture.categories.map((c) => `/${c.slug}/`),
      ...albums,
      '/cookies/',
    ].map((p) => `https://www.mullnyphotos.cz${p}`);
    expect(locs).toHaveLength(19);
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

  it('has four header nav links (home anchors, Reference only with reviews) and marks the wordmark as the current page', () => {
    expect(navLinks(html).map(hrefOf)).toEqual(['/#o-mne', '/#portfolio', '/#reference', '/#kontakt']);
    expect(html).toMatch(/class="wordmark t-wordmark" href="\/"[^>]*aria-current="page"/);
    // The drawer nav carries the same four links, and exactly one nav is exposed at any width.
    const drawer = /<nav aria-label="Hlavní navigace v menu"[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? '';
    expect([...drawer.matchAll(/href="([^"]+)"/g)].map((m) => m[1])).toEqual(['/#o-mne', '/#portfolio', '/#reference', '/#kontakt']);
  });

  it('overlays the hero only on the home page (data-over-hero) and uses a native details drawer', () => {
    expect(html).toMatch(/<header class="site-header" data-over-hero/);
    for (const page of Object.values(categoryHtml)) expect(page).not.toContain('data-over-hero');
    expect(html).toMatch(/<details class="menu" data-menu[^>]*>\s*<summary/);
    expect(html).toContain('Svatby · Portréty · Párové focení');
  });

  it('sets the anchor offset once, as scroll-padding on html, and no scroll-margin anywhere in the CSS', () => {
    const cssFiles = readdirSync(join(out, '_astro')).filter((f) => f.endsWith('.css'));
    const css = cssFiles.map((f) => readFileSync(join(out, '_astro', f), 'utf8')).join('\n');
    expect(css).toMatch(/scroll-padding-block-start:\s*var\(--header-height\)/);
    expect(css).not.toContain('scroll-margin');
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
