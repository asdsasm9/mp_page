/** Which WebP tier each place of the Instagram planner requests (T-351), and the srcset helpers behind it. */
import { describe, expect, it } from 'vitest';
import { COVER_ASPECT, PHOTO_IMG, coverWidth, fallbackTo480OnError, photoImgProps, photoWebpSrcSet, photoWebpUrl } from './images';

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

  it('grid tile keeps 480 as src and offers 720 and 960 for a 3:4 tile that is 360 px wide at 1280', () => {
    const props = photoImgProps(BASE, ID, 'grid')!;
    expect(props.src).toBe(photoWebpUrl(BASE, ID, 480));
    expect(props.srcSet).toBe(photoWebpSrcSet(BASE, ID, [480, 720, 960]));
    expect(chosenTier('grid', 1, true)).toBe(720);
    expect(chosenTier('grid', 2, true)).toBe(960);
    expect(chosenTier('grid', 2, false)).toBe(480);
    expect(chosenTier('grid', 3, false)).toBe(720);
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
