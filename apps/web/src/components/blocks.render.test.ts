// Render tests for the shared building blocks (T-276): Icon, Kicker, Section, PageHead, Plate, Breadcrumb, Photo (crop),
// CategoryCard and AlbumCard. They render each component with Astro's container and check markup, not looks.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import type { Snapshot, SnapshotPhoto } from '@mp/shared';
import { describe, expect, it } from 'vitest';
import fixtureJson from '../../../../packages/shared/fixtures/snapshot.fixture.json';
import type { CategoryCard as AlbumCardData } from '../lib/category';
import { cropSizes } from '../lib/images';
import AlbumCard from './AlbumCard.astro';
import Breadcrumb from './Breadcrumb.astro';
import { ctaLabel } from '../content/texts';
import CategoryCard from './CategoryCard.astro';
import CategoryGrid from './CategoryGrid.astro';
import Icon from './Icon.astro';
import Kicker from './Kicker.astro';
import PageHead from './PageHead.astro';
import Photo from './Photo.astro';
import Plate from './Plate.astro';
import Section from './Section.astro';

const IMG = 'https://img.mullnyphotos.cz';
const fixture = fixtureJson as unknown as Snapshot;
const all = fixture.categories.flatMap((c) => c.albums.flatMap((a) => a.photos));
const landscape = all.find((p) => p.width > p.height)!;
const portrait = all.find((p) => p.width < p.height)!;

/** Component HTML with Astro's scoped-style ids removed. */
const plain = (html: string): string => html.replace(/\sdata-astro-cid-[a-z0-9]+(="[^"]*")?/g, '');

/** The CSS of a component (its <style> block, comments removed), so comments in the frontmatter cannot trip a scan. */
const styleOf = (file: string): string =>
  (/<style>([\s\S]*)<\/style>/.exec(readFileSync(new URL(file, import.meta.url), 'utf8'))?.[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '');

async function render(
  component: Parameters<AstroContainer['renderToString']>[0],
  props: Record<string, unknown>,
  slot?: string,
): Promise<string> {
  const container = await AstroContainer.create();
  return plain(await container.renderToString(component, { props, slots: slot ? { default: slot } : undefined }));
}

const albumData = (over: Partial<AlbumCardData> = {}): AlbumCardData => ({
  slug: 'sedlakovi',
  title: 'Sedlákovi',
  place: 'Brno',
  path: '/svatby/sedlakovi/',
  photo: landscape,
  countLabel: '44 fotografií',
  eager: false,
  priority: false,
  ...over,
});

describe('Icon', () => {
  it('draws a decorative inline SVG with a path per name', async () => {
    for (const name of ['arrow-left', 'arrow-right', 'chevron-left', 'chevron-right']) {
      const html = await render(Icon, { name });
      expect(html, name).toMatch(/<svg[^>]*aria-hidden="true"/);
      expect(html).toContain('focusable="false"');
      expect(html).toContain('stroke="currentColor"');
      expect(html.match(/<path d="[^"]+"/g), name).toHaveLength(1);
      expect(html).not.toMatch(/<text|[←-↓]/);
    }
  });
});

describe('Kicker', () => {
  it('renders a paragraph by default and a span on request, with the text in the slot', async () => {
    expect(await render(Kicker, {}, 'O mně')).toMatch(/<p class="kicker t-kicker[^"]*"[^>]*>\s*O mně\s*<\/p>/);
    expect(await render(Kicker, { as: 'span' }, 'Brno')).toMatch(/<span class="kicker t-kicker/);
  });

  it('marks the dark tone and the rule-less variant', async () => {
    expect(await render(Kicker, { tone: 'dark' }, 'Reference')).toContain('data-tone="dark"');
    expect(await render(Kicker, { plain: true }, 'x')).toContain('data-plain');
    const light = await render(Kicker, {}, 'x');
    expect(light).not.toContain('data-tone');
    expect(light).not.toContain('data-plain');
  });
});

describe('Section', () => {
  const props = { id: 'portfolio', title: 'Portfolio', kicker: 'Moje práce', actionHref: '/portfolio/', actionLabel: 'Celé portfolio' };

  it('is a section named by its own h2, with kicker, hairline, action link with an arrow, and the slot', async () => {
    const html = await render(Section, props, '<p id="content">obsah</p>');
    expect(html).toMatch(/<section id="portfolio"[^>]*aria-labelledby="portfolio-nadpis"/);
    expect(html).toMatch(/<h2 id="portfolio-nadpis" class="t-h1">Portfolio<\/h2>/);
    expect(html).toContain('Moje práce');
    expect(html).toContain('class="rule" aria-hidden="true"');
    expect(html).toMatch(/<a class="action t-nav" href="\/portfolio\/">\s*Celé portfolio\s*<svg/);
    expect(html).toContain('<p id="content">obsah</p>');
    expect(html).toContain('data-band="ground"');
    expect(html).not.toContain('data-tone');
  });

  it('omits kicker and action when they are not given', async () => {
    const html = await render(Section, { id: 'kontakt', title: 'Kontakt' });
    expect(html).not.toContain('class="kicker');
    expect(html).not.toContain('class="action');
  });

  it('needs both href and label for the action', async () => {
    const html = await render(Section, { id: 'x', title: 'X', actionHref: '/a/' });
    expect(html).not.toContain('class="action');
  });

  it('the dark band switches to the dark tone (focus ring, kicker) and the surface band is marked', async () => {
    const dark = await render(Section, { ...props, id: 'reference', band: 'dark' });
    expect(dark).toContain('data-band="dark"');
    expect(dark).toMatch(/<section [^>]*data-tone="dark"/);
    expect(await render(Section, { ...props, band: 'surface' })).toContain('data-band="surface"');
  });

  it('sets no scroll-margin: html scroll-padding is the only anchor offset', () => {
    expect(styleOf('./Section.astro').length).toBeGreaterThan(100);
    expect(styleOf('./Section.astro')).not.toMatch(/scroll-margin/);
  });
});

describe('PageHead', () => {
  const props = {
    crumbs: [{ name: 'Svatby', path: '/svatby/' }],
    title: 'Svatby',
    backHref: '/portfolio/',
    backLabel: 'Všechna portfolia',
  };

  it('has the breadcrumb row, one h1, a hairline and the back link with an arrow', async () => {
    const html = await render(PageHead, props, '<p>Úvod</p>');
    expect(html).toContain('<nav class="breadcrumb"');
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html).toMatch(/<h1 class="t-h1">Svatby<\/h1>/);
    expect(html).toContain('<hr class="rule"');
    expect(html).toMatch(/<a class="back t-small" href="\/portfolio\/">\s*<svg[\s\S]*?<\/svg>\s*Všechna portfolia\s*<\/a>/);
    expect(html).toContain('<p>Úvod</p>');
  });

  it('shows the meta kicker only when given and omits the back link and intro otherwise', async () => {
    const html = await render(PageHead, { crumbs: props.crumbs, title: 'Svatby', kicker: 'Brno · 17. června 2023' });
    expect(html).toContain('Brno · 17. června 2023');
    expect(html).not.toContain('class="back');
    expect(html).not.toContain('class="intro');
    expect(await render(PageHead, { crumbs: props.crumbs, title: 'Svatby' })).not.toContain('class="kicker');
  });
});

describe('Breadcrumb (T-249 alignment kept)', () => {
  it('keeps Úvod first, links before the current page and a non-link current item', async () => {
    const html = await render(Breadcrumb, { crumbs: [{ name: 'Svatby', path: '/svatby/' }, { name: 'Sedlákovi', path: '/svatby/sedlakovi/' }] });
    expect(html).toContain('<nav class="breadcrumb" aria-label="Drobečková navigace"');
    expect(html.match(/<li/g)).toHaveLength(3);
    expect(html).toMatch(/<a href="\/">Úvod<\/a>/);
    expect(html).toMatch(/<li aria-current="page">Sedlákovi<\/li>/);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });

  it('gives links and the current item the same height box and baseline (the T-249 rule)', () => {
    const src = readFileSync(new URL('./Breadcrumb.astro', import.meta.url), 'utf8');
    expect(src).toMatch(/\.breadcrumb li \{[^}]*display: inline-flex;[^}]*align-items: center;[^}]*min-block-size: var\(--target-compact\)/s);
    expect(src).toMatch(/\.breadcrumb a \{[^}]*display: inline-flex;[^}]*align-items: center;[^}]*min-block-size: var\(--target-compact\)/s);
  });
});

describe('Plate', () => {
  it('wraps the slot and is matted by default, plain on request', async () => {
    const matted = await render(Plate, {}, '<img alt="" src="x">');
    expect(matted).toMatch(/<div class="plate" data-matted/);
    expect(matted).toContain('<img alt="" src="x">');
    expect(await render(Plate, { matted: false }, 'x')).not.toContain('data-matted');
  });
});

describe('no colour filter on photos, ever (WP-12 D-22)', () => {
  const srcDir = join(new URL('..', import.meta.url).pathname);
  const css = (rel: string): string => readFileSync(join(srcDir, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const FILES = [
    'components/Plate.astro',
    'components/Photo.astro',
    'components/CategoryCard.astro',
    'components/AlbumCard.astro',
    'components/AlbumGrid.astro',
    'styles/base.css',
  ];

  it.each(FILES)('%s has no filter property (backdrop-filter on the header pseudo-element is the only one)', (rel) => {
    expect(css(rel)).not.toMatch(/(^|[\s;{])filter\s*:/m);
    expect(css(rel)).not.toMatch(/\b(sepia|saturate|grayscale|hue-rotate|brightness|contrast)\(/);
  });

  it('only the header uses backdrop-filter', () => {
    expect(css('components/Header.astro')).toMatch(/backdrop-filter: blur/);
    for (const rel of FILES) expect(css(rel), rel).not.toMatch(/backdrop-filter/);
  });
});

describe('Photo crop', () => {
  const sizesOf = (html: string): string => /<source[^>]* sizes="([^"]*)"/.exec(html)?.[1] ?? '';
  const imgOf = (html: string): string => /<img[^>]*>/.exec(html)?.[0] ?? '';

  it('uses the crop-aware sizes of the photo own aspect ratio and a uniform crop class', async () => {
    for (const photo of [landscape, portrait]) {
      for (const crop of ['category', 'album'] as const) {
        const html = await render(Photo, { photo, base: IMG, alt: '', crop });
        const jpeg = photo.variants.jpeg;
        expect(sizesOf(html), `${crop} ${jpeg.w}x${jpeg.h}`).toBe(cropSizes(crop, jpeg.w, jpeg.h).replace(/&/g, '&amp;'));
        expect(sizesOf(html)).not.toMatch(/px/);
        expect(imgOf(html)).toMatch(new RegExp(`class="[^"]*crop crop-${crop}`));
      }
    }
  });

  it('a landscape cover asks for about twice the box width, a portrait cover for no more than the box width', async () => {
    const wide = sizesOf(await render(Photo, { photo: landscape, base: IMG, alt: '', crop: 'category' }));
    expect(wide).toMatch(/calc\(21rem \* (1\.9\d|2)\)/);
    const tall = sizesOf(await render(Photo, { photo: portrait, base: IMG, alt: '', crop: 'album' }));
    expect(tall).toBe('(min-width: 48rem) 26rem, calc(100vw - 3rem)');
  });

  it('the priority (LCP) card gets the plain box-width sizes, the others stay crop-aware (WP-12 decision 13)', async () => {
    const lcp = sizesOf(await render(Photo, { photo: landscape, base: IMG, alt: '', crop: 'album', eager: true, priority: true }));
    expect(lcp).toBe('(min-width: 48rem) 26rem, calc(100vw - 3rem)');
    const eager = sizesOf(await render(Photo, { photo: landscape, base: IMG, alt: '', crop: 'album', eager: true }));
    expect(eager).toMatch(/calc\(26rem \* 1\.\d+\)/);
    const catLcp = sizesOf(await render(Photo, { photo: landscape, base: IMG, alt: '', crop: 'category', priority: true }));
    expect(catLcp).not.toContain('*');
  });

  it('an explicit sizes prop wins over crop, and a photo without crop keeps the context sizes and no crop class', async () => {
    expect(sizesOf(await render(Photo, { photo: landscape, base: IMG, alt: '', crop: 'album', sizes: '10rem' }))).toBe('10rem');
    const plainHtml = await render(Photo, { photo: landscape, base: IMG, alt: '', context: 'card' });
    expect(imgOf(plainHtml)).not.toContain('crop');
    expect(sizesOf(plainHtml)).toContain('(min-width: 48rem) min(');
  });

  it('keeps alt, stored width and height, and the dominant colour placeholder with crop', async () => {
    const photo: SnapshotPhoto = { ...landscape, alt: 'Ráno nevěsty' };
    const html = imgOf(await render(Photo, { photo, base: IMG, alt: 'Ráno nevěsty', crop: 'category' }));
    expect(html).toContain('alt="Ráno nevěsty"');
    expect(html).toMatch(/\swidth="\d+"/);
    expect(html).toMatch(/\sheight="\d+"/);
  });

  it('never lists a tier the photo does not have (a small master is not upscaled by us)', async () => {
    const small: SnapshotPhoto = {
      ...landscape,
      width: 700,
      height: 467,
      variants: {
        master: { w: 700, h: 467, bytes: 1 },
        webp: [{ tier: 480, w: 480, h: 320, bytes: 1 }],
        jpeg: { w: 700, h: 467, bytes: 1 },
        og: { w: 700, h: 367, bytes: 1 },
      },
    };
    const html = await render(Photo, { photo: small, base: IMG, alt: '', crop: 'category' });
    expect(html).toContain('480.webp 480w');
    expect(html).not.toMatch(/(720|960|1600|2400)\.webp/);
  });
});

describe('CategoryCard', () => {
  const props = { href: '/svatby/', title: 'Svatby', meta: '4 alba', photo: landscape, base: IMG };

  it('is one list item with ONE link around cover, meta and name; the cover is decorative', async () => {
    const html = await render(CategoryCard, props);
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toMatch(/<li class="card">\s*<a href="\/svatby\/">/);
    expect(html).toMatch(/<\/a>\s*<\/li>/);
    expect(html).toMatch(/<img[^>]*\salt(?:="")?[\s>]/);
    expect(html).toContain('class="card-title t-h3">Svatby</span>');
    expect(html).toContain('4 alba');
    expect(html).toMatch(/crop crop-category/);
  });

  it('puts the meta kicker before the name and omits it without meta', async () => {
    const html = await render(CategoryCard, props);
    expect(html.indexOf('4 alba')).toBeLessThan(html.indexOf('card-title'));
    expect(await render(CategoryCard, { ...props, meta: undefined })).not.toContain('kicker');
  });

  it('loads lazily by default, eager and low for the first row, high for the priority card', async () => {
    expect(await render(CategoryCard, props)).toContain('loading="lazy"');
    const eager = await render(CategoryCard, { ...props, eager: true });
    expect(eager).toContain('loading="eager"');
    expect(eager).not.toContain('fetchpriority="high"');
    expect(await render(CategoryCard, { ...props, eager: true, priority: true })).toContain('fetchpriority="high"');
  });

  it('styles: accent only as a stroke, thicker underline on hover, zoom only under no-preference, no filter, no radius', () => {
    const src = styleOf('./CategoryCard.astro');
    expect(src).toMatch(/text-decoration-color: var\(--color-accent\)/);
    expect(src).toMatch(/a:hover \.card-title \{[^}]*text-decoration-thickness: var\(--bar-thickness\)/s);
    expect(src).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*scale\(1\.03\)/);
    expect(src.slice(0, src.indexOf('@media'))).not.toMatch(/scale\(/);
    expect(src).not.toMatch(/border-radius|filter/);
  });
});

describe('CategoryGrid (T-279)', () => {
  it('is a list that renders the slot', async () => {
    const html = await render(CategoryGrid, {}, '<li>a</li>');
    expect(html).toMatch(/<ul class="cards[^"]*">\s*<li>a<\/li>\s*<\/ul>/);
  });

  it('collapses empty tracks (auto-fit), caps the track width at the widths the cover sizes assume and centres, from 48rem', () => {
    const css = styleOf('./CategoryGrid.astro');
    expect(css).toMatch(/repeat\(auto-fill, minmax\(min\(15rem, 100%\), 1fr\)\)/);
    expect(css).toMatch(/@media \(min-width: 48rem\) \{[^@]*repeat\(auto-fit, minmax\(min\(15rem, 100%\), var\(--track-max\)\)\);[^@]*justify-content: center/s);
    expect(css).toMatch(/--track-max: 21rem/);
    expect(css).toMatch(/@media \(min-width: 80rem\) \{\s*\.cards \{\s*--track-max: 18rem/);
    expect(css).toMatch(/@media \(min-width: 100rem\) \{\s*\.cards \{\s*--track-max: 16rem/);
  });
});

describe('category call to action labels (T-279)', () => {
  it('are keyed by slug and fall back for admin-created categories', () => {
    expect(ctaLabel('svatby')).toBe('Poptat svatební focení');
    expect(ctaLabel('portrety')).toBe('Poptat portrétní focení');
    expect(ctaLabel('parove-foceni')).toBe('Poptat párové focení');
    expect(ctaLabel('novorozenci')).toBe('Poptat focení');
  });
});

describe('AlbumCard', () => {
  it('shows place and the photo count with the Czech plural in the meta kicker and uses the 4/5 crop', async () => {
    const html = await render(AlbumCard, { card: albumData(), base: IMG });
    expect(html).toContain('Brno · 44 fotografií');
    expect(html).toContain('crop crop-album');
    expect(html).toMatch(/<a href="\/svatby\/sedlakovi\/">/);
    expect(html.match(/<a /g)).toHaveLength(1);
  });

  it('meta lines for one and for a few photos, and without a place', async () => {
    expect(await render(AlbumCard, { card: albumData({ countLabel: '1 fotografie' }), base: IMG })).toContain('Brno · 1 fotografie');
    expect(await render(AlbumCard, { card: albumData({ place: null, countLabel: '3 fotografie' }), base: IMG })).toMatch(
      />\s*3 fotografie\s*</,
    );
    const noPlace = await render(AlbumCard, { card: albumData({ place: null }), base: IMG });
    expect(noPlace).not.toContain(' · ');
  });

  it('passes eager and priority through to the cover', async () => {
    const html = await render(AlbumCard, { card: albumData({ eager: true, priority: true }), base: IMG });
    expect(html).toContain('loading="eager"');
    expect(html).toContain('fetchpriority="high"');
  });
});
