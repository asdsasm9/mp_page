import { SnapshotSchema } from '@mp/shared';
import { describe, expect, it } from 'vitest';
import fixtureJson from '../../../../packages/shared/fixtures/snapshot.fixture.json';
import {
  FIXED_PATHS_AFTER,
  FIXED_PATHS_BEFORE,
  MAX_IMAGES_PER_URL,
  buildRobots,
  buildSitemap,
  sitemapPaths,
  xmlEscape,
} from './sitemap';

const fixture = SnapshotSchema.parse(fixtureJson);
const IMG = 'https://img.mullnyphotos.cz';
const urlBlocks = (xml: string): string[] => [...xml.matchAll(/<url>[\s\S]*?<\/url>/g)].map((m) => m[0]);
const locOf = (block: string): string => /<loc>([^<]*)<\/loc>/.exec(block)![1]!;

describe('sitemapPaths', () => {
  it('lists home, portfolio, categories, albums and the three fixed pages: 1 + 1 + 3 + 13 + 3 = 21', () => {
    const albums = fixture.categories.flatMap((c) => c.albums.map((a) => `/${c.slug}/${a.slug}/`));
    const expected = [
      ...FIXED_PATHS_BEFORE,
      ...fixture.categories.map((c) => `/${c.slug}/`),
      ...albums,
      ...FIXED_PATHS_AFTER,
    ];
    expect(sitemapPaths(fixture.categories)).toEqual(expected);
    expect(expected).toHaveLength(2 + fixture.categories.length + albums.length + 3);
    expect(expected).toHaveLength(21);
    expect(expected).not.toContain('/404/');
  });

  it('skips albums without photos, like the album route', () => {
    const copy = structuredClone(fixture);
    copy.categories[0]!.albums[0]!.photos = [];
    expect(sitemapPaths(copy.categories)).toHaveLength(20);
  });
});

describe('buildSitemap', () => {
  const xml = buildSitemap(fixture.categories, IMG);
  const blocks = urlBlocks(xml);

  it('is a urlset with the image namespace and absolute locs on the site origin', () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"');
    expect(blocks.map(locOf)).toEqual(sitemapPaths(fixture.categories).map((p) => `https://www.mullnyphotos.cz${p}`));
    expect(xml).not.toMatch(/changefreq|priority/);
  });

  it('has lastmod for categories and albums from updatedAt, and none for fixed pages', () => {
    for (const b of blocks) {
      const path = new URL(locOf(b)).pathname;
      const depth = path.split('/').filter(Boolean).length;
      const isCatalog = depth === 2 || (depth === 1 && fixture.categories.some((c) => path === `/${c.slug}/`));
      if (isCatalog) expect(b, path).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
      else expect(b, path).not.toContain('<lastmod>');
    }
    const first = fixture.categories[0]!;
    const block = blocks.find((b) => locOf(b).endsWith(`/${first.slug}/`))!;
    expect(block).toContain(`<lastmod>${first.updatedAt.slice(0, 10)}</lastmod>`);
  });

  it('gives each album one image:image per photo, sedlakovi 44, with 1600 JPEG locs and captions', () => {
    for (const c of fixture.categories) {
      for (const a of c.albums) {
        const block = blocks.find((b) => locOf(b) === `https://www.mullnyphotos.cz/${c.slug}/${a.slug}/`)!;
        expect([...block.matchAll(/<image:image>/g)], a.slug).toHaveLength(a.photos.length);
      }
    }
    const sedlakovi = blocks.find((b) => locOf(b).endsWith('/svatby/sedlakovi/'))!;
    expect([...sedlakovi.matchAll(/<image:loc>([^<]+)<\/image:loc>/g)]).toHaveLength(44);
    expect(sedlakovi).toMatch(/<image:loc>https:\/\/img\.mullnyphotos\.cz\/[^<]+\/1600\.jpg<\/image:loc>/);
    expect(sedlakovi).toContain('fotografie 12 z 44</image:caption>');
    const imageBlocks = blocks.filter((b) => b.includes('<image:image>'));
    expect(imageBlocks).toHaveLength(13);
  });

  it('makes a relative dev image base absolute', () => {
    expect(buildSitemap(fixture.categories, '/_dev-img')).toContain('<image:loc>https://www.mullnyphotos.cz/_dev-img/');
  });

  it('escapes & < > " \' in titles and captions (Michal & Rozárka)', () => {
    const copy = structuredClone(fixture);
    const album = copy.categories[0]!.albums[0]!;
    album.title = 'Michal & Rozárka';
    album.photos[0]!.alt = `A & B <i> "q" 'x'`;
    const out = buildSitemap(copy.categories, IMG);
    expect(out).toContain('Michal &amp; Rozárka');
    expect(out).toContain('A &amp; B &lt;i&gt; &quot;q&quot; &apos;x&apos;');
    expect(out).not.toContain('Michal & Rozárka');
    expect(out).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;)/);
  });

  it(`caps images at ${MAX_IMAGES_PER_URL} per url`, () => {
    const copy = structuredClone(fixture);
    const album = copy.categories[0]!.albums[0]!;
    const photo = album.photos[0]!;
    album.photos = Array.from({ length: MAX_IMAGES_PER_URL + 5 }, () => photo);
    const block = urlBlocks(buildSitemap(copy.categories, IMG)).find((b) => locOf(b).endsWith(`/${album.slug}/`))!;
    expect([...block.matchAll(/<image:image>/g)]).toHaveLength(MAX_IMAGES_PER_URL);
  });
});

describe('xmlEscape', () => {
  it('escapes the five XML characters', () => {
    expect(xmlEscape(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&apos;');
  });
});

describe('buildRobots', () => {
  it('production allows all and names the absolute sitemap', () => {
    const r = buildRobots(true);
    expect(r).toContain('User-agent: *\nAllow: /\n');
    expect(r).toContain('Sitemap: https://www.mullnyphotos.cz/sitemap.xml');
    expect(r).not.toContain('Disallow');
  });

  it('non-production disallows everything and has no Sitemap line', () => {
    const r = buildRobots(false);
    expect(r).toContain('Disallow: /\n');
    expect(r).not.toContain('Sitemap');
    expect(r).not.toContain('Allow: /');
  });
});
