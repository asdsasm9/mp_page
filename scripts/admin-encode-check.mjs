// admin-encode-check (WP5-20): runs the real admin encoder (apps/admin/src/encode, canvasSurface.ts) in Chrome on sharp
// fixtures and checks what it produced: file set == planUploadFiles, magic bytes, sizes within 1 px of variantPlan,
// master <= 3000 px and never upscaled, EXIF orientation applied, no Exif/GPS in master / 1600 JPEG / OG, dominant colour.
// Usage: CHROME_PATH=/path/to/chrome npm run admin-encode-check [-- --break-exif] [--out dir]
//   --break-exif  injects an Exif+GPS segment into every produced 1600 JPEG before checking; the run must then FAIL (exit 1)
//   --out dir     also writes every produced file there for a look
// Exit 0 pass, 1 fail, 2 skipped (no Chrome). Fixtures and the bundle live in .tmp/admin-encode/ (gitignored).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { findChrome } from './design-check.mjs';
import { SKIPPED_MESSAGE } from './design-check-lib.mjs';
import { detectType, injectExif, judgePhoto, metadataOf } from './admin-encode-lib.mjs';
import { generateFixtures } from './admin-encode-fixtures.mjs';
import { createDistServer, listen } from './serve-dist.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const breakExif = args.includes('--break-exif');
const outDir = opt('--out', null);
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const site = join(root, '.tmp', 'admin-encode', 'site');

const chrome = findChrome();
if (!chrome) {
  console.log(SKIPPED_MESSAGE);
  process.exit(2);
}

const { default: puppeteer } = await import('puppeteer-core');
const { build } = await import('vite');

// Bundle the real encoder for the browser (no minify, so a failure reads well).
rmSync(site, { recursive: true, force: true });
mkdirSync(site, { recursive: true });
await build({
  configFile: false,
  root,
  logLevel: 'warn',
  publicDir: false,
  build: {
    outDir: site,
    emptyOutDir: false,
    minify: false,
    target: 'es2022',
    lib: { entry: join(root, 'scripts', 'admin-encode-entry.mjs'), formats: ['iife'], name: 'AdminEncode', fileName: () => 'encoder.js' },
  },
});
writeFileSync(join(site, 'index.html'), '<!doctype html><meta charset="utf-8"><title>admin-encode-check</title><link rel="icon" href="data:,"><script src="/encoder.js"></script>');
const fixtures = await generateFixtures(join(site, 'fixtures'));

const failures = [];
const rows = [];
const { server, origin } = await listen(createDistServer(site));
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  page.on('console', (m) => (m.type() === 'error' ? console.error(`page console: ${m.text()}`) : undefined));
  await page.goto(`${origin}/index.html`);
  await page.waitForFunction(() => window.adminEncodeReady === true, { timeout: 15000 });

  for (const fx of fixtures) {
    let res;
    try {
      res = await page.evaluate((n, u, t) => window.adminEncode(n, u, t), fx.name, `/fixtures/${fx.name}`, fx.type);
    } catch (e) {
      failures.push(`${fx.name}: encoder threw: ${e.message}`);
      rows.push({ name: fx.name, error: true });
      continue;
    }
    for (const f of res.files) {
      f.buf = Buffer.from(f.base64, 'base64');
      delete f.base64;
      if (breakExif && f.kind === 'jpeg') f.buf = injectExif(f.buf);
      const meta = await sharp(f.buf).metadata();
      f.w = meta.width;
      f.h = meta.height;
    }
    if (outDir) {
      const dir = resolve(outDir, fx.name);
      mkdirSync(dir, { recursive: true });
      for (const f of res.files) writeFileSync(join(dir, f.kind + (f.tier ? `-${f.tier}` : '') + (f.kind === 'webp' ? '.webp' : '.jpg')), f.buf);
    }
    const bad = judgePhoto(fx, res);
    failures.push(...bad);
    const get = (k) => res.files.find((f) => f.kind === k);
    const dims = (f) => (f ? `${f.w}x${f.h}` : '-');
    const meta = ['master', 'jpeg', 'og'].map((k) => metadataOf(get(k).buf)).some((m) => m.exif || m.gps || m.xmp || m.iptc);
    rows.push({
      name: fx.name,
      src: `${fx.displayW}x${fx.displayH}${fx.orientation === 1 ? '' : ` (exif ${fx.orientation})`}`,
      master: dims(get('master')),
      jpeg: dims(get('jpeg')),
      og: dims(get('og')),
      webp: res.files.filter((f) => f.kind === 'webp').map((f) => f.tier).join('/'),
      kinds: `${res.files.length}/${res.planFiles.length}`,
      magic: res.files.map((f) => detectType(f.buf)[0]).join(''),
      meta: meta ? 'FOUND' : 'none',
      colour: res.dominantColor ?? '-',
      ms: Math.round(res.ms),
      heap: res.heapMB,
      result: bad.length ? 'FAIL' : 'ok',
    });
  }
  await page.close();
} catch (e) {
  failures.push(`error: ${e.message}`);
  console.error(e);
} finally {
  await browser.close();
  server.close();
}

const cols = [
  ['fixture', 'name'], ['source', 'src'], ['master', 'master'], ['1600', 'jpeg'], ['og', 'og'], ['webp tiers', 'webp'],
  ['files', 'kinds'], ['magic', 'magic'], ['exif/gps', 'meta'], ['colour', 'colour'], ['ms', 'ms'], ['heap MB', 'heap'], ['result', 'result'],
];
const line = (cells) => cells.map((c, i) => String(c ?? '').padEnd(Math.max(...[cols[i][0], ...rows.map((r) => String(r[cols[i][1]] ?? ''))].map((s) => s.length)))).join('  ');
console.log(line(cols.map((c) => c[0])));
for (const r of rows) console.log(line(cols.map((c) => r[c[1]])));
const times = rows.map((r) => r.ms).filter((m) => typeof m === 'number');
if (times.length) console.log(`peak time per photo: ${Math.max(...times)} ms (${rows.find((r) => r.ms === Math.max(...times)).name}); total ${times.reduce((a, b) => a + b, 0)} ms${breakExif ? '; --break-exif active' : ''}`);
console.log(failures.length ? `ADMIN_ENCODE: FAIL\n${failures.map((f) => `- ${f}`).join('\n')}` : 'ADMIN_ENCODE: PASS');
process.exit(failures.length ? 1 : 0);
