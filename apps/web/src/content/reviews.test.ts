import { describe, expect, it } from 'vitest';
import { REVIEWS } from './reviews';

describe('reviews (T-320: the carousel shows the full text, there is no excerpt)', () => {
  for (const review of REVIEWS) {
    it(`${review.name}: has a name and a full text and no excerpt field`, () => {
      expect(review.name.length).toBeGreaterThan(0);
      expect(review.text.length).toBeGreaterThan(150);
      expect(Object.keys(review).sort()).toEqual(['albumId', 'name', 'text']);
    });
  }
});
