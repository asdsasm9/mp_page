import { readFileSync } from 'node:fs';
import type { Snapshot, SnapshotPhoto } from '@mp/shared';
import { describe, expect, it } from 'vitest';
import fixtureJson from '../../../../packages/shared/fixtures/snapshot.fixture.json';
import { loadingAttrs, ogImage, photoSources, sizesFor } from './images';

const IMG = 'https://img.mullnyphotos.cz';
const ID = '00000000-0000-4000-8000-000000000001';
const fixture = fixtureJson as unknown as Snapshot;

const photo = (over: Partial<SnapshotPhoto> = {}): SnapshotPhoto => ({
  id: ID,
  width: 3000,
  height: 2000,
  alt: null,
  caption: null,
  dominantColor: '#aabbcc',
  variants: {
    master: { w: 3000, h: 2000, bytes: 1 },
    webp: [
      { tier: 480, w: 480, h: 320, bytes: 1 },
      { tier: 960, w: 960, h: 640, bytes: 1 },
    ],
    jpeg: { w: 1600, h: 1067, bytes: 1 },
    og: { w: 1200, h: 630, bytes: 1 },
  },
  ...over,
});

describe('photoSources', () => {
  it('lists only the tiers that exist', () => {
    const s = photoSources(photo(), IMG);
    expect(s.webpSrcset).toBe(`${IMG}/photos/${ID}/480.webp 480w, ${IMG}/photos/${ID}/960.webp 960w`);
    expect(s.webpSrcset).not.toContain('1600.webp');
    expect(s.webpSrcset).not.toContain('2400.webp');
  });

  it('gives a 300x200 photo one entry with its real width', () => {
    const small = photo({
      width: 300,
      height: 200,
      variants: {
        master: { w: 300, h: 200, bytes: 1 },
        webp: [{ tier: 480, w: 300, h: 200, bytes: 1 }],
        jpeg: { w: 300, h: 200, bytes: 1 },
        og: { w: 300, h: 157, bytes: 1 },
      },
    });
    const s = photoSources(small, IMG);
    expect(s.webp).toHaveLength(1);
    expect(s.webpSrcset).toBe(`${IMG}/photos/${ID}/480.webp 300w`);
    expect(s.width).toBe(300);
    expect(s.height).toBe(200);
  });

  it('uses the stored variant dimensions and the 1600.jpg fallback', () => {
    const s = photoSources(photo(), `${IMG}/`);
    expect(s.fallback.url).toBe(`${IMG}/photos/${ID}/1600.jpg`);
    expect([s.width, s.height]).toEqual([1600, 1067]);
    expect(s.webp.map((e) => [e.width, e.height])).toEqual([[480, 320], [960, 640]]);
  });

  it('carries the dominant colour as a placeholder, or null', () => {
    expect(photoSources(photo(), IMG).placeholderStyle).toBe('--c:#aabbcc');
    expect(photoSources(photo({ dominantColor: null }), IMG).placeholderStyle).toBeNull();
  });

  it('every URL starts with the image base for the whole fixture', () => {
    for (const c of fixture.categories)
      for (const a of c.albums)
        for (const p of a.photos) {
          const s = photoSources(p, IMG);
          for (const u of [s.fallback.url, ...s.webp.map((e) => e.url), ogImage(p, IMG).url]) expect(u.startsWith(`${IMG}/`)).toBe(true);
          expect(s.webp.length).toBe(p.variants.webp.length);
          expect(s.width).toBeGreaterThan(0);
          expect(s.height).toBeGreaterThan(0);
        }
  });
});

describe('sizesFor', () => {
  it('returns a sizes string per context without pixel units', () => {
    for (const c of ['grid', 'card', 'lightbox', 'hero'] as const) {
      expect(sizesFor(c).length).toBeGreaterThan(0);
      expect(sizesFor(c)).not.toMatch(/px/);
    }
    expect(sizesFor('lightbox')).toBe('100vw');
    // Cards sit in three columns from 48rem.
    expect(sizesFor('card')).toBe('(min-width: 48rem) 33vw, 100vw');
  });
});

describe('ogImage', () => {
  it('uses og.jpg with the stored og dimensions', () => {
    expect(ogImage(photo(), IMG)).toEqual({ url: `${IMG}/photos/${ID}/og.jpg`, width: 1200, height: 630, type: 'image/jpeg' });
  });
});

describe('loadingAttrs', () => {
  it('is lazy with no fetchpriority by default', () => {
    expect(loadingAttrs()).toEqual({ loading: 'lazy', decoding: 'async' });
  });
  it('eager only when requested', () => {
    expect(loadingAttrs({ eager: true })).toEqual({ loading: 'eager', decoding: 'async' });
  });
  it('fetchpriority high only for the priority image, which is eager', () => {
    expect(loadingAttrs({ priority: true })).toEqual({ loading: 'eager', decoding: 'async', fetchpriority: 'high' });
  });
});

describe('Photo.astro source scan', () => {
  const src = readFileSync(new URL('../components/Photo.astro', import.meta.url), 'utf8');
  const markup = src.replace(/^---[\s\S]*?---/, '');
  const imgs = [...markup.matchAll(/<img\b[\s\S]*?\/>/g)].map((m) => m[0]);

  it('has an img and every img carries alt, width and height', () => {
    expect(imgs.length).toBeGreaterThanOrEqual(1);
    for (const tag of imgs) {
      expect(tag).toMatch(/\salt=\{alt\}/);
      expect(tag).toMatch(/\swidth=\{src\.width\}/);
      expect(tag).toMatch(/\sheight=\{src\.height\}/);
    }
  });

  it('does not hardcode eager loading or fetchpriority', () => {
    expect(markup).not.toMatch(/loading="eager"|fetchpriority="high"/);
  });

  it('requires alt in the props', () => {
    expect(src).toMatch(/\balt: string;/);
  });
});
