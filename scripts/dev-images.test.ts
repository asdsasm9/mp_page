import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SnapshotSchema } from '../packages/shared/src/snapshot';
import {
  GALLERIES_DIR,
  SNAPSHOT_FIXTURE,
  devPhotosFromSnapshot,
  dominantColorOf,
  generateDevImages,
  publicKeys,
  type DevImageRow,
} from './dev-images';

const root = join(__dirname, '..', '.tmp', `dev-images-test-${process.pid}`);
const galleries = join(root, 'galleries');
const out = join(root, 'out');

const snapshot = SnapshotSchema.parse(JSON.parse(readFileSync(SNAPSHOT_FIXTURE, 'utf8')));
const photos = devPhotosFromSnapshot(snapshot);
const missing = photos.find((p) => p.legacyKey !== null)!;

let first: DevImageRow[];
let second: DevImageRow[];

beforeAll(async () => {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const skip = join(GALLERIES_DIR, ...missing.legacyKey!.split('/'));
  cpSync(GALLERIES_DIR, galleries, { recursive: true, filter: (src) => src !== skip });
  first = await generateDevImages(photos, { galleriesDir: galleries, outDir: out });
  second = await generateDevImages(photos, { galleriesDir: galleries, outDir: out });
}, 280_000);

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('generateDevImages', () => {
  it('creates a directory with all planned tiers for every fixture photo', () => {
    expect(photos.length).toBeGreaterThan(0);
    expect(first).toHaveLength(photos.length);
    for (const p of photos) {
      const dir = join(out, 'photos', p.id);
      expect(existsSync(join(dir, '480.webp')), `${p.id} 480.webp`).toBe(true);
      expect(existsSync(join(dir, '1600.jpg')), `${p.id} 1600.jpg`).toBe(true);
      expect(existsSync(join(dir, 'og.jpg')), `${p.id} og.jpg`).toBe(true);
      for (const k of publicKeys(p)) expect(existsSync(join(out, ...k.key.split('/'))), k.key).toBe(true);
    }
  });

  it('makes a correctly sized placeholder for the photo with a missing source, real images for the rest', async () => {
    const row = first.find((r) => r.id === missing.id)!;
    expect(row.placeholder).toBe(true);
    expect(first.filter((r) => r.placeholder)).toHaveLength(photos.filter((p) => p.legacyKey === null).length + 1);
    for (const k of publicKeys(missing)) {
      const meta = await sharp(join(out, ...k.key.split('/'))).metadata();
      expect([meta.width, meta.height], k.key).toEqual([k.w, k.h]);
    }
    const real = first.find((r) => r.id !== missing.id && !r.placeholder);
    expect(real).toBeDefined();
  });

  it('reports a #rrggbb colour for every photo, computed from the generated image when there is a source', () => {
    for (const r of first) expect(r.color, r.id).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('dominantColorOf returns the colour of a solid image', async () => {
    const buf = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#336699' } }).png().toBuffer();
    expect(await dominantColorOf(buf)).toBe('#336699');
  });

  it('a second run creates no files', () => {
    expect(second.every((r) => r.created === 0)).toBe(true);
    expect(second.reduce((a, r) => a + r.created, 0)).toBe(0);
    expect(statSync(out).isDirectory()).toBe(true);
  });
});
