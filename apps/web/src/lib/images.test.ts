import { readFileSync } from 'node:fs';
import type { Snapshot, SnapshotPhoto } from '@mp/shared';
import { describe, expect, it } from 'vitest';
import fixtureJson from '../../../../packages/shared/fixtures/snapshot.fixture.json';
import { coverSizes, cropFactor, cropSizes, loadingAttrs, ogImage, photoSources, sizesFor } from './images';

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

  it('mixed catalog: a photo with 720 lists it, a legacy photo without 720 renders a srcset without it', () => {
    const withTier = photo({
      variants: {
        ...photo().variants,
        webp: [
          { tier: 480, w: 480, h: 320, bytes: 1 },
          { tier: 720, w: 720, h: 480, bytes: 1 },
          { tier: 960, w: 960, h: 640, bytes: 1 },
        ],
      },
    });
    const a = photoSources(withTier, IMG);
    expect(a.webpSrcset).toBe(
      `${IMG}/photos/${ID}/480.webp 480w, ${IMG}/photos/${ID}/720.webp 720w, ${IMG}/photos/${ID}/960.webp 960w`,
    );
    const legacy = photoSources(photo(), IMG);
    expect(legacy.webpSrcset).not.toContain('720');
    expect(legacy.webp.map((e) => e.width)).toEqual([480, 960]);
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
    // Cards sit in three columns from 48rem, capped at the real column maximum.
    expect(sizesFor('card')).toBe('(min-width: 48rem) min((100vw - 7rem) / 3, 33rem), calc(100vw - 3rem)');
    expect(sizesFor('grid')).toBe('(min-width: 64rem) min(33vw, 24.5rem), (min-width: 40rem) 50vw, calc(100vw - 3rem)');
    expect(sizesFor('hero')).toBe('100vw');
  });
});

describe('coverSizes (crop-aware sizes, WP-12 F10)', () => {
  const CATEGORY = '(min-width: 48rem) 21rem, calc(100vw - 3rem)';
  const ALBUM = '(min-width: 48rem) 20rem, calc(100vw - 3rem)';

  it('cropFactor is max(1, aspect x box height / width), rounded to 2 decimals', () => {
    // category box 3 / 4 (height over width 4 / 3)
    expect(cropFactor(1.5, 4 / 3)).toBe(2);
    expect(cropFactor(1, 4 / 3)).toBe(1.33);
    expect(cropFactor(0.8, 4 / 3)).toBe(1.07);
    // album box 4 / 5 (height over width 5 / 4)
    expect(cropFactor(1.5, 5 / 4)).toBe(1.88);
    expect(cropFactor(1, 5 / 4)).toBe(1.25);
    expect(cropFactor(0.8, 5 / 4)).toBe(1);
    // a photo narrower than the box never shrinks the request
    expect(cropFactor(0.5, 5 / 4)).toBe(1);
    expect(cropFactor(Number.NaN, 5 / 4)).toBe(1);
  });

  it('multiplies every length and leaves the media conditions alone (landscape 3:2 into 3/4: twice the box width)', () => {
    expect(coverSizes(CATEGORY, 1.5, 4 / 3)).toBe('(min-width: 48rem) calc(21rem * 2), calc((100vw - 3rem) * 2)');
    expect(coverSizes(ALBUM, 1.5, 5 / 4)).toBe('(min-width: 48rem) calc(20rem * 1.88), calc((100vw - 3rem) * 1.88)');
    expect(coverSizes(CATEGORY, 1, 4 / 3)).toBe('(min-width: 48rem) calc(21rem * 1.33), calc((100vw - 3rem) * 1.33)');
  });

  it('returns the box-width string unchanged when the photo already fills the box (k = 1)', () => {
    expect(coverSizes(ALBUM, 0.8, 5 / 4)).toBe(ALBUM);
    expect(coverSizes(CATEGORY, 0.5, 4 / 3)).toBe(CATEGORY);
  });

  it('keeps commas inside min() and calc() together and wraps a bare min() length', () => {
    expect(coverSizes('(min-width: 48rem) min((100vw - 7rem) / 3, 24.5rem), calc(100vw - 2rem)', 1.5, 4 / 3)).toBe(
      '(min-width: 48rem) calc(min((100vw - 7rem) / 3, 24.5rem) * 2), calc((100vw - 2rem) * 2)',
    );
    expect(coverSizes('100vw', 1.5, 4 / 3)).toBe('calc(100vw * 2)');
  });

  it('cropSizes uses the photo aspect and the box of the crop context, with no px', () => {
    for (const crop of ['category', 'album'] as const) {
      for (const [w, h] of [[1600, 1067], [1067, 1600], [1000, 1000], [2400, 1200]] as const) {
        const s = cropSizes(crop, w, h);
        expect(s, `${crop} ${w}x${h}`).not.toMatch(/px/);
        expect(s).toMatch(/^\(min-width: \d+rem\) /);
      }
    }
    expect(cropSizes('category', 1600, 1067)).toBe(
      '(min-width: 48rem) calc(22rem * 2), calc((100vw - 3rem) * 2)',
    );
    expect(cropSizes('album', 1067, 1600)).toBe(ALBUM); // a portrait photo fills the 4 / 5 box with no extra width
  });

  it('T-333/T-335 profile crop: 12rem from 48rem, 6rem on phones, times the landscape crop factor of the square box', () => {
    expect(cropSizes('profile', 1000, 1000)).toBe('(min-width: 48rem) 12rem, 6rem');
    expect(cropSizes('profile', 1600, 1067)).toBe('(min-width: 48rem) calc(12rem * 1.5), calc(6rem * 1.5)');
    expect(cropSizes('profile', 1067, 1600)).toBe('(min-width: 48rem) 12rem, 6rem');
  });
});

describe('master and lightboxSet', () => {
  const big = (tiers: Array<480 | 720 | 960 | 1600 | 2400>): SnapshotPhoto =>
    photo({
      variants: {
        ...photo().variants,
        webp: tiers.map((t) => ({ tier: t, w: t, h: Math.round((t * 2) / 3), bytes: 1 })),
      },
    });

  it('master comes from masterKey with the stored dimensions', () => {
    expect(photoSources(photo(), `${IMG}/`).master).toEqual({ url: `${IMG}/photos/${ID}/master.jpg`, width: 3000, height: 2000 });
  });

  it('lightboxSet lists the 1600 and 2400 tiers that exist', () => {
    const s = photoSources(big([480, 720, 960, 1600, 2400]), IMG);
    expect(s.lightboxSet).toBe(`${IMG}/photos/${ID}/1600.webp 1600w, ${IMG}/photos/${ID}/2400.webp 2400w`);
    expect(photoSources(big([480, 960, 1600]), IMG).lightboxSet).toBe(`${IMG}/photos/${ID}/1600.webp 1600w`);
  });

  it('lightboxSet falls back to the largest tier for a small master', () => {
    expect(photoSources(big([480, 720, 960]), IMG).lightboxSet).toBe(`${IMG}/photos/${ID}/960.webp 960w`);
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
    // Eager but not the LCP image: low priority so it does not compete with the LCP image on slow links.
    expect(loadingAttrs({ eager: true })).toEqual({ loading: 'eager', decoding: 'async', fetchpriority: 'low' });
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

  it('placeholder: --c colour variable via style, background from --c, block-size auto (CLS 0)', () => {
    expect(markup).toMatch(/style=\{src\.placeholderStyle\}/);
    expect(src).toMatch(/background-color: var\(--c, var\(--color-placeholder\)\)/);
    expect(src).toMatch(/block-size: auto/);
  });

  it('does not hardcode eager loading or fetchpriority', () => {
    expect(markup).not.toMatch(/loading="eager"|fetchpriority="high"/);
  });

  it('requires alt in the props', () => {
    expect(src).toMatch(/\balt: string;/);
  });
});
