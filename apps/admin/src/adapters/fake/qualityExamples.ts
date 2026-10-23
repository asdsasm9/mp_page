/**
 * Mixed quality examples for the browser fake world (T-260): the first four photos of the first album become
 * a low-resolution landscape, a good landscape, a good landscape without the 720 tier ("Chybí varianta") and a good
 * portrait. Only the browser world uses it; the shared fixture and the unit-test worlds stay untouched.
 */
import { variantPlan, type PhotoVariants, type Snapshot } from '@mp/shared';

interface Options {
  /** Planned WebP tiers to leave out. */
  skipTiers?: number[];
}

/** Variants for a master of w x h with bytes in the order of magnitude of the quality plan (0.15 / 0.05 B per px). */
export function exampleVariants(w: number, h: number, options: Options = {}): PhotoVariants {
  const plan = variantPlan(w, h);
  const bytes = (pw: number, ph: number, perPx: number) => Math.round(pw * ph * perPx);
  return {
    master: { w, h, bytes: bytes(w, h, 0.33) },
    webp: plan.webp
      .filter((e) => !(options.skipTiers ?? []).includes(e.tier))
      .map((e) => ({ tier: e.tier as 480, w: e.w, h: e.h, bytes: bytes(e.w, e.h, 0.15) })),
    jpeg: { w: plan.jpeg.w, h: plan.jpeg.h, bytes: bytes(plan.jpeg.w, plan.jpeg.h, 0.23) },
    og: { w: plan.og.w, h: plan.og.h, bytes: bytes(plan.og.w, plan.og.h, 0.13) },
  };
}

const EXAMPLES: Array<{ w: number; h: number; options?: Options }> = [
  { w: 1480, h: 987 },
  { w: 3000, h: 2000 },
  { w: 3000, h: 2000, options: { skipTiers: [720] } },
  { w: 1500, h: 2250 },
];

export function withQualityExamples(snapshot: Snapshot): Snapshot {
  const album = snapshot.categories.flatMap((c) => c.albums).find((a) => a.photos.length >= EXAMPLES.length);
  if (!album) return snapshot;
  EXAMPLES.forEach((example, i) => {
    const photo = album.photos[i]!;
    photo.width = example.w;
    photo.height = example.h;
    photo.variants = exampleVariants(example.w, example.h, example.options);
  });
  return snapshot;
}
