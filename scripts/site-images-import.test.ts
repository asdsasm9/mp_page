import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script without types
import { SITE_FILES, importSiteImages, MAX_EDGE } from './site-images-import.mjs';

const root = join(__dirname, '..', '.tmp', `site-images-test-${process.pid}`);
const src = join(root, 'src');
const out = join(root, 'out');

async function makeSource(rel: string, w: number, h: number) {
  const file = join(src, ...rel.split('/'));
  mkdirSync(dirname(file), { recursive: true });
  const img = sharp({ create: { width: w, height: h, channels: 3, background: '#336699' } });
  await (rel.endsWith('.png') ? img.png() : img.jpeg()).toFile(file);
}

beforeAll(async () => {
  rmSync(root, { recursive: true, force: true });
  for (const rel of SITE_FILES as string[]) {
    // one oversized file proves the long edge is capped
    await makeSource(rel, rel === 'home/main.jpg' ? 3600 : 300, rel === 'home/main.jpg' ? 1200 : 200);
  }
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('importSiteImages', () => {
  it('writes exactly 15 files (no instagram.png) with long edge at most 2400, and a rerun keeps them all', async () => {
    expect(SITE_FILES).not.toContain('contact/instagram.png');
    const rows = await importSiteImages({ srcDir: src, outDir: out });
    expect(rows).toHaveLength(15);
    expect(rows.every((r: { action: string }) => r.action === 'written')).toBe(true);
    for (const r of rows as Array<{ rel: string; width: number; height: number }>) {
      expect(Math.max(r.width, r.height), r.rel).toBeLessThanOrEqual(MAX_EDGE);
    }
    const main = (rows as Array<{ rel: string; width: number; height: number }>).find((r) => r.rel === 'home/main.jpg')!;
    expect([main.width, main.height]).toEqual([2400, 800]);

    const again = await importSiteImages({ srcDir: src, outDir: out });
    expect(again).toHaveLength(15);
    expect(again.every((r: { action: string }) => r.action === 'kept')).toBe(true);
  });

  it('throws when a source image is missing', async () => {
    await expect(importSiteImages({ srcDir: join(root, 'nope'), outDir: join(root, 'out2') })).rejects.toThrow(
      /missing source image/,
    );
  });
});
