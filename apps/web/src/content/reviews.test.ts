import { describe, expect, it } from 'vitest';
import { REVIEWS } from './reviews';

/** Split into sentences, each keeping its end mark. The last one may have no end mark. */
function sentences(text: string): string[] {
  return text.match(/[^.!?]+(?:[.!?]+|$)/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
}

describe('review short texts', () => {
  for (const review of REVIEWS) {
    describe(review.name, () => {
      it('is 150 to 220 characters', () => {
        expect(review.short.length).toBeGreaterThanOrEqual(150);
        expect(review.short.length).toBeLessThanOrEqual(220);
      });

      it('is shorter than the full text', () => {
        expect(review.short.length).toBeLessThan(review.text.length);
      });

      it('is a run of whole contiguous sentences of the full text', () => {
        const full = sentences(review.text);
        const short = sentences(review.short);
        expect(short.length).toBeGreaterThan(0);
        const start = full.indexOf(short[0] as string);
        expect(start).toBeGreaterThanOrEqual(0);
        expect(full.slice(start, start + short.length)).toEqual(short);
        expect(review.text).toContain(review.short);
      });
    });
  }
});
