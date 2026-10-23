import type { SnapshotAlbum, SnapshotCategory, SnapshotPhoto } from '@mp/shared';
import { describe, expect, it } from 'vitest';
import {
  albumGallery,
  breadcrumbList,
  categoryGallery,
  person,
  photographerFull,
  photographerRef,
  serializeJsonLd,
  SITE_ORIGIN,
  website,
  type JsonLd,
} from './jsonld';

const IMG = 'https://img.mullnyphotos.cz';
const OG = `${IMG}/photos/00000000-0000-4000-8000-000000000001/og.jpg`;

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const photo = (n: number, alt: string | null = `Popis ${n}`): SnapshotPhoto => ({
  id: id(n),
  width: 3000,
  height: 2000,
  alt,
  caption: null,
  dominantColor: null,
  variants: {
    master: { w: 3000, h: 2000, bytes: 1 },
    webp: [
      { tier: 480, w: 480, h: 320, bytes: 1 },
      { tier: 960, w: 960, h: 640, bytes: 1 },
    ],
    jpeg: { w: 1600, h: 1067, bytes: 1 },
    og: { w: 1200, h: 630, bytes: 1 },
  },
});
const album = (slug: string, title: string, count: number, cover = 1): SnapshotAlbum => ({
  slug,
  title,
  place: null,
  shotOn: null,
  description: null,
  seoTitle: null,
  seoDescription: null,
  coverPhotoId: id(cover),
  legacyId: null,
  updatedAt: '2026-10-19T00:00:00.000Z',
  photos: Array.from({ length: count }, (_, i) => photo(i + 1)),
});
const category = (albums: SnapshotAlbum[]): SnapshotCategory => ({
  slug: 'svatby',
  name: 'Svatby',
  description: null,
  seoTitle: null,
  seoDescription: null,
  coverPhotoId: null,
  updatedAt: '2026-10-19T00:00:00.000Z',
  albums,
});

/** Every string value in the tree. */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out));
  return out;
}
const filled = (v: unknown): boolean => (typeof v === 'string' ? v.trim() !== '' : v !== undefined && v !== null);
const expectFilled = (o: JsonLd, keys: string[]) => keys.forEach((k) => expect(filled(o[k]), k).toBe(true));
const OPTIONAL_UNANSWERED = ['telephone', 'priceRange', 'openingHoursSpecification', 'geo', 'aggregateRating', 'review'];

describe('Photographer (5.1)', () => {
  const p = photographerFull(OG);
  it('has the required properties, non-empty', () => {
    expectFilled(p, ['@context', '@type', '@id', 'name', 'url', 'image', 'address', 'areaServed', 'email', 'sameAs']);
    expect(p['@type']).toBe('Photographer');
    expect(p['@id']).toBe(`${SITE_ORIGIN}/#business`);
    expect(p.name).toBe('Mullny Photos');
    expect(p.url).toBe(`${SITE_ORIGIN}/`);
    expect(p.address).toEqual({
      '@type': 'PostalAddress',
      addressLocality: 'Brno',
      addressRegion: 'Jihomoravský kraj',
      addressCountry: 'CZ',
    });
    expect(p.email).toBe('mullnyphotos@gmail.com');
    expect(p.description).toMatch(/Brn/);
    expect(p.areaServed).toContainEqual({ '@type': 'City', name: 'Brno' });
    expect(p.sameAs).toEqual(['https://www.instagram.com/mullny_photos/', 'https://mywed.com/cs/photographer/mullny/']);
  });
  it('omits unanswered optional properties and street address', () => {
    for (const k of OPTIONAL_UNANSWERED) expect(p).not.toHaveProperty(k);
    expect(p.address).not.toHaveProperty('streetAddress');
    expect(p.address).not.toHaveProperty('postalCode');
  });
  it('reference is just an @id', () => {
    expect(photographerRef()).toEqual({ '@id': `${SITE_ORIGIN}/#business` });
  });
  it('uses only absolute https URLs', () => {
    for (const s of [p.url, p.image, ...(p.sameAs as string[])]) expect(s).toMatch(/^https:\/\//);
    expect(strings(p).join(' ')).not.toContain('github.io');
  });
});

describe('Person (5.2)', () => {
  const p = person(OG);
  it('has the required properties', () => {
    expectFilled(p, ['@context', '@type', '@id', 'name', 'jobTitle', 'worksFor', 'url', 'image']);
    expect(p.name).toBe('Terezie Müllnerová');
    expect(p.jobTitle).toBe('Fotografka');
    expect(p.worksFor).toEqual({ '@id': `${SITE_ORIGIN}/#business` });
    expect(p.url).toBe(`${SITE_ORIGIN}/o-mne/`);
    expect(p['@id']).toBe(`${SITE_ORIGIN}/#terezie`);
  });
});

describe('ImageGallery (5.3)', () => {
  const big = album('adam-eliska', 'Adam & Eliška', 44, 7);
  const cat = category([big, album('druhy', 'Druhý', 3)]);
  const g = albumGallery(cat, big, 'Popis stránky.', IMG);
  const images = g.image as JsonLd[];

  it('album gallery has the required properties', () => {
    expectFilled(g, ['@context', '@type', 'name', 'url', 'description', 'inLanguage', 'creator', 'image']);
    expect(g['@type']).toBe('ImageGallery');
    expect(g.url).toBe(`${SITE_ORIGIN}/svatby/adam-eliska/`);
    expect(g.inLanguage).toBe('cs');
    expect(g.creator).toEqual({ '@id': `${SITE_ORIGIN}/#business` });
  });

  it('44 photos emit 20 ImageObjects with the cover first', () => {
    expect(images).toHaveLength(20);
    expect(images[0]!.contentUrl).toBe(`${IMG}/photos/${id(7)}/1600.jpg`);
    expect(images[1]!.contentUrl).toBe(`${IMG}/photos/${id(1)}/1600.jpg`);
    expect(new Set(images.map((i) => i.contentUrl)).size).toBe(20);
  });

  it('every ImageObject has contentUrl, thumbnailUrl, size and a name', () => {
    for (const img of images) {
      expect(img['@type']).toBe('ImageObject');
      expectFilled(img, ['contentUrl', 'thumbnailUrl', 'width', 'height', 'name']);
      expect(img.contentUrl as string).toMatch(/^https:\/\/img\.mullnyphotos\.cz\/photos\/.+\/1600\.jpg$/);
      expect(img.thumbnailUrl as string).toMatch(/\/480\.webp$/);
      expect(img.width).toBe(1600);
      expect(img.height).toBe(1067);
      expect(img.name as string).not.toMatch(/\.(jpe?g|webp)$/);
    }
  });

  it('empty alt falls back to the default text, never a file name', () => {
    const a = album('x', 'Titul', 2);
    a.photos[1] = photo(2, null);
    const imgs = albumGallery(category([a]), a, 'd', IMG).image as JsonLd[];
    expect(imgs[1]!.name).toBe('Titul – svatba, fotografie 2 z 2');
  });

  it('optional shoot date and place appear only when set', () => {
    expect(g).not.toHaveProperty('dateCreated');
    expect(g).not.toHaveProperty('contentLocation');
    const a = { ...album('x', 'T', 1), shotOn: '2025-06-14', place: 'Lednice' };
    const withOptional = albumGallery(category([a]), a, 'd', IMG);
    expect(withOptional.dateCreated).toBe('2025-06-14');
    expect(withOptional.contentLocation).toEqual({ '@type': 'Place', name: 'Lednice' });
  });

  it('category gallery has one ImageObject per album cover linking to the album', () => {
    const c = categoryGallery(cat, 'Popis kategorie.', IMG);
    expectFilled(c, ['@context', '@type', 'name', 'url', 'description', 'inLanguage', 'creator', 'image']);
    expect(c.url).toBe(`${SITE_ORIGIN}/svatby/`);
    const items = c.image as JsonLd[];
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.name)).toEqual(['Adam & Eliška', 'Druhý']);
    expect(items[0]!.url).toBe(`${SITE_ORIGIN}/svatby/adam-eliska/`);
    expect(items[0]!.contentUrl).toBe(`${IMG}/photos/${id(7)}/1600.jpg`);
  });
});

describe('BreadcrumbList (5.4)', () => {
  it('album: Úvod > category > album, positions 1..n, absolute items', () => {
    const b = breadcrumbList([
      { name: 'Svatby', path: '/svatby/' },
      { name: 'Adam & Eliška', path: '/svatby/adam-eliska/' },
    ]);
    expectFilled(b, ['@context', '@type', 'itemListElement']);
    expect(b['@type']).toBe('BreadcrumbList');
    const items = b.itemListElement as Array<Record<string, unknown>>;
    expect(items.map((i) => i.position)).toEqual([1, 2, 3]);
    expect(items.map((i) => i.name)).toEqual(['Úvod', 'Svatby', 'Adam & Eliška']);
    expect(items.map((i) => i.item)).toEqual([
      `${SITE_ORIGIN}/`,
      `${SITE_ORIGIN}/svatby/`,
      `${SITE_ORIGIN}/svatby/adam-eliska/`,
    ]);
    items.forEach((i) => expect(i['@type']).toBe('ListItem'));
  });
  it('about has two items', () => {
    const items = breadcrumbList([{ name: 'O mně', path: '/o-mne/' }]).itemListElement as unknown[];
    expect(items).toHaveLength(2);
  });
});

describe('WebSite (5.5)', () => {
  it('has the required properties and no SearchAction', () => {
    const w = website();
    expectFilled(w, ['@context', '@type', 'name', 'url', 'inLanguage']);
    expect(w.url).toBe(`${SITE_ORIGIN}/`);
    expect(w).not.toHaveProperty('potentialAction');
  });
});

describe('whole output', () => {
  const cat = category([album('a', 'A', 44)]);
  const all: JsonLd[] = [
    photographerFull(OG),
    website(),
    person(OG),
    albumGallery(cat, cat.albums[0]!, 'd', IMG),
    categoryGallery(cat, 'd', IMG),
    breadcrumbList([{ name: 'Svatby', path: '/svatby/' }]),
  ];
  it('never contains Review or AggregateRating', () => {
    const text = serializeJsonLd(all);
    expect(text).not.toMatch(/Review|AggregateRating|aggregateRating|"review"/);
  });
  it('every URL is absolute https on the production origin or the image host', () => {
    const urls = strings(all).filter((s) => /^https?:/.test(s) && s !== 'https://schema.org');
    expect(urls.length).toBeGreaterThan(40);
    for (const u of urls) {
      expect(u).toMatch(/^https:\/\//);
      expect(
        u.startsWith(SITE_ORIGIN) || u.startsWith(IMG) || /^https:\/\/(www\.instagram\.com|mywed\.com)\//.test(u),
        u,
      ).toBe(true);
    }
  });
});

describe('serializeJsonLd', () => {
  const hostile = '</script><img src=x onerror=1>';
  it('hostile title has no raw </script>, <, > or &', () => {
    const a = { ...album('h', hostile, 2), place: '<b>&' };
    const g = albumGallery(category([a]), a, `${hostile} opis`, IMG);
    const text = serializeJsonLd([g, breadcrumbList([{ name: hostile, path: '/svatby/h/' }])]);
    expect(text).not.toContain('</script>');
    expect(text.toLowerCase()).not.toContain('<');
    expect(text).not.toMatch(/[<>&]/);
    // Round trip keeps the original text.
    const parsed = JSON.parse(text) as JsonLd[];
    expect(parsed[0]!.name).toBe(hostile);
  });
  it('escapes the line and paragraph separators', () => {
    const original = `x${String.fromCharCode(0x2028)}y${String.fromCharCode(0x2029)}z`;
    const text = serializeJsonLd({ a: original });
    expect(text).toBe('{"a":"x\\u2028y\\u2029z"}');
    expect((JSON.parse(text) as { a: string }).a).toBe(original);
  });
});
