// Icon generator (plan WP3-21): legacy logo -> square PNG icons in apps/web/public. Outputs are committed.
// Usage: npm run icons -w apps/web
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const legacy = resolve(here, '..', '..', '..', 'legacy', 'public-root');
const pub = resolve(here, '..', 'public');
// Same value as --color-theme in tokens.css (the logo has a transparent background, icons need an opaque one).
const BACKGROUND = '#f6f4f1';

async function square(size: number): Promise<Buffer> {
  const inner = Math.round(size * 0.7);
  const logo = await sharp(resolve(legacy, 'logo.png')).resize(inner, inner, { fit: 'inside' }).toBuffer();
  return sharp({ create: { width: size, height: size, channels: 3, background: BACKGROUND } })
    .composite([{ input: logo, gravity: 'centre' }])
    .png()
    .toBuffer();
}

async function main(): Promise<void> {
  mkdirSync(pub, { recursive: true });
  const i180 = await square(180);
  const i192 = await square(192);
  const i512 = await square(512);
  writeFileSync(resolve(pub, 'apple-touch-icon.png'), i180);
  writeFileSync(resolve(pub, 'icon-192.png'), i192);
  writeFileSync(resolve(pub, 'icon-512.png'), i512);
  // Old absolute paths still requested by crawlers and old manifests: same bytes as the icons.
  writeFileSync(resolve(pub, 'logo.png'), i512);
  writeFileSync(resolve(pub, 'android-chrome-192x192.png'), i192);
  copyFileSync(resolve(legacy, 'favicon.ico'), resolve(pub, 'favicon.ico'));
  console.log('icons written to apps/web/public');
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
