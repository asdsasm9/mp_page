/** Which WebP tier each place of the Instagram planner requests (T-351), and the srcset helpers behind it. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COVER_ASPECT, IG_FRAME_TILE_HEIGHT, IG_FRAME_TILE_WIDTH, PHOTO_IMG,coverWidth, fallbackTo480OnError, photoImgProps, photoWebpSrcSet, photoWebpUrl } from './images';

const BASE = 'https://img.example.test';
const ID = '123e4567-e89b-42d3-a456-426614174000';

/** The width in CSS px the browser picks a candidate for: the first `sizes` entry whose media query matches. */
function chosenTier(place: keyof typeof PHOTO_IMG, dpr: number, wide: boolean): number {
  const { tiers, sizes } = PHOTO_IMG[place];
  const entries = sizes.split(/,\s*(?=\()|,\s*(?=\d)/);
  const entry = wide ? entries[0]! : entries[entries.length - 1]!;
  const css = Number(/(\d+)px$/.exec(entry)![1]);
  const need = css * dpr;
  return tiers.find((t) => t >= need) ?? tiers[tiers.length - 1]!;
}

describe('photo image helpers', () => {
  it('builds a width-descriptor srcset from the shared key scheme and refuses bad ids', () => {
    expect(photoWebpSrcSet(BASE, ID, [720, 960])).toBe(`${BASE}/photos/${ID}/720.webp 720w, ${BASE}/photos/${ID}/960.webp 960w`);
    expect(photoWebpSrcSet(BASE, 'nope', [720])).toBeNull();
    expect(photoImgProps(BASE, 'nope', 'strip')).toBeNull();
  });

  it('sizes a cover-cropped photo by height times 3:2, not by the box width', () => {
    expect(COVER_ASPECT).toBe(1.5);
    expect(coverWidth(360, 480)).toBe(720);
    expect(coverWidth(165, 165)).toBe(248);
  });

  it('strip and picker never use the 480 tier: src is 720, srcset 720 and 960', () => {
    for (const place of ['strip', 'picker'] as const) {
      const props = photoImgProps(BASE, ID, place)!;
      expect(props.src).toBe(photoWebpUrl(BASE, ID, 720));
      expect(props.srcSet).toBe(photoWebpSrcSet(BASE, ID, [720, 960]));
      expect(props.srcSet).not.toContain('480');
    }
  });

  it('grid tile keeps 480 as src and offers 720 and 960 for a 3:4 tile that is about 138 px wide in the 26 rem frame at 1280', () => {
    const props = photoImgProps(BASE, ID, 'grid')!;
    expect(props.src).toBe(photoWebpUrl(BASE, ID, 480));
    expect(props.srcSet).toBe(photoWebpSrcSet(BASE, ID, [480, 720, 960]));
    expect(props.sizes).toMatch(/^\(min-width: 64rem\) 276px,/);
    expect(chosenTier('grid', 1, true)).toBe(480);
    expect(chosenTier('grid', 2, true)).toBe(720);
    expect(chosenTier('grid', 3, true)).toBe(960);
    expect(chosenTier('grid', 2, false)).toBe(480);
    expect(chosenTier('grid', 3, false)).toBe(720);
  });

  it('the wide grid size covers the real tile of the frame token (--ig-frame-max, minus the border, in thirds, 3:4)', () => {
    const tokens = readFileSync(`${import.meta.dirname}/../styles/tokens.css`, 'utf8');
    const rem = Number(/--ig-frame-max:\s*([\d.]+)rem/.exec(tokens)![1]);
    const gap = Number(/--ig-grid-gap:\s*([\d.]+)rem/.exec(tokens)![1]) * 16;
    const tileWidth = (rem * 16 - 2 - 2 * gap) / 3;
    expect(tileWidth).toBeLessThanOrEqual(IG_FRAME_TILE_WIDTH);
    expect(tileWidth).toBeGreaterThan(IG_FRAME_TILE_WIDTH - 2);
    expect(IG_FRAME_TILE_HEIGHT).toBe(Math.ceil((IG_FRAME_TILE_WIDTH * 4) / 3));
    const need = coverWidth(tileWidth, (tileWidth * 4) / 3);
    const wide = Number(/^\(min-width: 64rem\) (\d+)px/.exec(PHOTO_IMG.grid.sizes)![1]);
    expect(wide).toBeGreaterThanOrEqual(need);
    // 2x screens still get a file that is at least as wide as the cover-cropped tile in device pixels.
    expect(chosenTier('grid', 2, true)).toBeGreaterThanOrEqual(need * 2);
  });

  it('picks 720 on a 1x or 2x strip and 960 at 3x', () => {
    expect(chosenTier('strip', 1, true)).toBe(720);
    expect(chosenTier('strip', 2, true)).toBe(720);
    expect(chosenTier('strip', 3, true)).toBe(960);
    expect(chosenTier('picker', 2, true)).toBe(960);
  });

  it('falls back to the 480 file once when a larger tier is missing', () => {
    const img = document.createElement('img');
    img.setAttribute('src', `${BASE}/photos/${ID}/720.webp`);
    img.setAttribute('srcset', `${BASE}/photos/${ID}/720.webp 720w`);
    Object.defineProperty(img, 'currentSrc', { value: `${BASE}/photos/${ID}/960.webp`, configurable: true });
    fallbackTo480OnError({ currentTarget: img });
    expect(img.getAttribute('src')).toBe(`${BASE}/photos/${ID}/480.webp`);
    expect(img.hasAttribute('srcset')).toBe(false);
    // A second error (the 480 is missing too) changes nothing and does not loop.
    Object.defineProperty(img, 'currentSrc', { value: `${BASE}/photos/${ID}/480.webp`, configurable: true });
    fallbackTo480OnError({ currentTarget: img });
    expect(img.getAttribute('src')).toBe(`${BASE}/photos/${ID}/480.webp`);
  });
});
