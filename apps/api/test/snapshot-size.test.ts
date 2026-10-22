import { describe, expect, it } from 'vitest';
import { SnapshotSchema, assertPublishable, buildSnapshot } from '@mp/shared';
import { syntheticCatalog } from './synthetic-catalog';

/** WP4-19: the snapshot for 4000 photos stays under 6 MB. Timing is measured by `npm run bench:snapshot`, not asserted. */
describe('snapshot size at the 4000-photo ceiling', () => {
  const rows = syntheticCatalog({ photos: 4000, redirects: 200 });
  const snapshot = buildSnapshot(rows, new Date('2026-10-19T12:00:00.000Z'));
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot)).byteLength;

  it('has all 4000 photos and is publishable', () => {
    expect(snapshot.counts.photos).toBe(4000);
    expect(() => assertPublishable(snapshot)).not.toThrow();
  });

  it('serialises to under 6 MB', () => {
    expect(bytes).toBeLessThan(6 * 1024 * 1024);
  });

  it('round-trips through a full validation parse', () => {
    expect(SnapshotSchema.safeParse(JSON.parse(JSON.stringify(snapshot))).success).toBe(true);
  });
});
