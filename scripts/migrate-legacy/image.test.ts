import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { variantsMatchPlan } from '../../packages/shared/src/api';
import { allLegacyKeys } from '../../packages/shared/src/legacy/albums';
import { MASTER_MAX_EDGE, sumBytes, variantPlan } from '../../packages/shared/src/variants';
import { GALLERIES_DIR, hasExif } from '../dev-images';
import { JPEG_QUALITY, MASTER_QUALITY, OG_QUALITY, WEBP_QUALITY, processImage } from './image';

/** Synthetic JPEG with a horizontal gradient so resizing has something to do. */
async function synth(w: number, h: number, extra?: (p: ReturnType<typeof sharp>) => ReturnType<typeof sharp>): Promise<Buffer> {
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      raw[i] = Math.round((x / w) * 255);
      raw[i + 1] = Math.round((y / h) * 255);
      raw[i + 2] = 96;
    }
  }
  const pipe = sharp(raw, { raw: { width: w, height: h, channels: 3 } });
  return (extra ? extra(pipe) : pipe).jpeg({ quality: 90 }).toBuffer();
}

describe('quality constants', () => {
  it('stay the legacy values (the browser encoder now uses the shared QUALITY_TABLE, WP-10 T-261)', () => {
    // legacy sources are already lossy web JPEGs, so migrate-legacy keeps q85/q80 (plan section 6)
    expect([MASTER_QUALITY, WEBP_QUALITY, JPEG_QUALITY, OG_QUALITY]).toEqual([85, 80, 85, 82]);
  });
});

describe('processImage', () => {
  const cases: Array<[string, number, number]> = [
    ['964 px landscape', 964, 643],
    ['1480 px landscape', 1480, 987],
    ['3162 px landscape (downscaled to 3000)', 3162, 2108],
    ['portrait', 800, 1200],
    ['tiny, below the 720 tier', 300, 200],
  ];
  for (const [name, w, h] of cases) {
    it(`${name}: dimensions equal the plan`, async () => {
      const r = await processImage(await synth(w, h));
      expect(Math.max(r.master.w, r.master.h)).toBeLessThanOrEqual(MASTER_MAX_EDGE);
      if (Math.max(w, h) <= MASTER_MAX_EDGE) expect([r.master.w, r.master.h]).toEqual([w, h]);
      const plan = variantPlan(r.master.w, r.master.h);
      expect(r.webp.map((x) => x.tier)).toEqual(plan.webp.map((x) => x.tier));
      if (r.master.w >= 720) expect(r.webp.map((x) => x.tier)).toContain(720);
      for (const x of r.webp) expect(x.w).toBeLessThanOrEqual(r.master.w);
      expect(r.jpeg.w).toBeLessThanOrEqual(r.master.w);
      expect(r.og.w).toBeLessThanOrEqual(r.master.w);
      expect(variantsMatchPlan(r.variants, r.master.w, r.master.h)).toBe(true);
      // real decoded sizes, real byte counts
      for (const f of [r.master, r.jpeg, r.og, ...r.webp]) {
        const m = await sharp(f.buffer).metadata();
        expect(Math.abs((m.width ?? 0) - f.w)).toBeLessThanOrEqual(1);
        expect(Math.abs((m.height ?? 0) - f.h)).toBeLessThanOrEqual(1);
      }
      expect(r.variants.master.bytes).toBe(r.master.buffer.length);
      expect(r.bytesTotal).toBe(sumBytes(r.variants));
      expect(r.dominantColor).toMatch(/^#[0-9a-f]{6}$/);
    });
  }

  it('is deterministic', async () => {
    const src = await synth(964, 643);
    const a = await processImage(src);
    const b = await processImage(src);
    expect(a.dominantColor).toBe(b.dominantColor);
    expect(a.bytesTotal).toBe(b.bytesTotal);
    expect(a.master.buffer.equals(b.master.buffer)).toBe(true);
  });

  it('applies EXIF orientation and strips EXIF/GPS from every output', async () => {
    // 600x400 stored, orientation 6 (rotate 90): the displayed image is 400x600.
    const src = await synth(600, 400, (p) =>
      p.withMetadata({
        orientation: 6,
        exif: { IFD0: { Copyright: 'secret' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '49/1 11/1 0/1' } },
      }),
    );
    expect(await hasExif(src)).toBe(true);
    expect((await sharp(src).metadata()).orientation).toBe(6);
    const r = await processImage(src);
    expect([r.master.w, r.master.h]).toEqual([400, 600]);
    for (const f of [r.master, r.jpeg, r.og, ...r.webp]) expect(await hasExif(f.buffer)).toBe(false);
    // the orientation tag must not remain either
    expect((await sharp(r.master.buffer).metadata()).orientation).toBeUndefined();
  });

  it('negative: an encoder that keeps metadata is detected by hasExif', async () => {
    const src = await synth(600, 400, (p) => p.withExif({ IFD0: { Copyright: 'secret' } }));
    const keeping = await sharp(src).withMetadata().jpeg().toBuffer();
    const dropping = await sharp(src).jpeg().toBuffer();
    expect(await hasExif(keeping)).toBe(true);
    expect(await hasExif(dropping)).toBe(false);
  });

  it('rejects data that is not an image', async () => {
    await expect(processImage(Buffer.from('not an image'))).rejects.toThrow(/cannot decode/);
  });

  it('smoke: a real legacy photo', async () => {
    const key = allLegacyKeys()[0]!;
    const file = join(GALLERIES_DIR, ...key.split('/'));
    if (!existsSync(file)) return;
    const r = await processImage(readFileSync(file));
    expect(variantsMatchPlan(r.variants, r.master.w, r.master.h)).toBe(true);
    expect(r.bytesTotal).toBeGreaterThan(0);
  });
});
