// One-off import of the 3 site images the home page really uses (plan WP3-6, CONTENT-MAPPING row "site/*"; trimmed from 15 in T-284).
// Reads legacy/fotky_web/site/ (read-only), writes apps/web/src/assets/site/ with the long edge at most
// 2400 px (JPEG quality 80, PNG lossless). The result is committed so the build survives the later
// removal of legacy/. Idempotent: an existing output file is kept (use --force to regenerate).
// Usage: npm run site-images:import
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, '..');
export const DEFAULT_SRC = join(REPO_ROOT, 'legacy', 'fotky_web', 'site');
export const DEFAULT_OUT = join(REPO_ROOT, 'apps', 'web', 'src', 'assets', 'site');
export const MAX_EDGE = 2400;
export const JPEG_QUALITY = 80;

/** The three legacy images the rebuilt home page still imports (T-284 dropped the 12 that became unused). */
export const SITE_FILES = ['home/main.jpg', 'home/hello.jpg', 'about/wedding.jpg'];

/** Imports every file; returns one row per file with the action taken. */
export async function importSiteImages({ srcDir = DEFAULT_SRC, outDir = DEFAULT_OUT, force = false } = {}) {
  const rows = [];
  for (const rel of SITE_FILES) {
    const src = join(srcDir, ...rel.split('/'));
    const out = join(outDir, ...rel.split('/'));
    if (!existsSync(src)) throw new Error(`missing source image: ${rel}`);
    if (existsSync(out) && !force) {
      rows.push({ rel, action: 'kept', bytes: statSync(out).size });
      continue;
    }
    mkdirSync(dirname(out), { recursive: true });
    const pipeline = sharp(src)
      .rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true });
    const info = rel.endsWith('.png')
      ? await pipeline.png({ compressionLevel: 9, effort: 10 }).toFile(out)
      : await pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toFile(out);
    rows.push({ rel, action: 'written', bytes: info.size, width: info.width, height: info.height });
  }
  return rows;
}

/** Total bytes of all files below a directory. */
export function dirBytes(dir) {
  let total = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    total += e.isDirectory() ? dirBytes(full) : statSync(full).size;
  }
  return total;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rows = await importSiteImages({ force: process.argv.includes('--force') });
  for (const r of rows) console.log(`${r.action.padEnd(8)} ${r.rel.padEnd(28)} ${r.bytes} bytes`);
  console.log(`${rows.length} files, ${dirBytes(DEFAULT_OUT)} bytes in ${DEFAULT_OUT}`);
}
