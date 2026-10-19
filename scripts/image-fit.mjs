// image-fit: does each photo load the right tier? For widths x DPR on /, /svatby/ and an album page it checks
//   natural width >= rendered width x DPR  (no upscaling blur)  and  <= 1.6 x that (no heavy overfetch), CLS 0.
// Usage: CHROME_PATH=/path/to/chrome npm run image-fit [-- --routes /a/ --widths 412 --dprs 1,2 --dist dir --json out.json]
//        npm run image-fit -- --placeholders .tmp/placeholders   screenshots with image requests held back (colour blocks)
//        npm run image-fit -- --from measurements.json            judge saved measurements, no Chrome (used by tests)
// Needs a built apps/web/dist (npm run build -w apps/web). Exit 0 pass, 1 fail, 2 skipped (no Chrome).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { findChrome } from './design-check.mjs';
import { SKIPPED_MESSAGE } from './design-check-lib.mjs';
import { createDistServer, listen } from './serve-dist.mjs';
import { EXIT, evaluate, formatTable, parseFitArgs, srcsetWidths, verdictLine } from './image-fit-lib.mjs';

const HELP = 'node scripts/image-fit.mjs [--routes /a/,/b/] [--widths 360,412] [--dprs 1,2,3] [--dist apps/web/dist] [--json file] [--placeholders dir] [--from file]';

async function scrollThrough(page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += innerHeight / 2) {
      scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 80));
    }
    const imgs = [...document.querySelectorAll('picture.photo img')];
    await Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; }))));
    await new Promise((r) => setTimeout(r, 150));
    scrollTo(0, 0);
  });
}

// img.naturalWidth is in CSS px (file width / the density the browser chose from `sizes`), so the real file width
// comes from the matching w descriptor of the srcset, or, for the JPEG fallback, from decoding the file.
async function measurePage() {
  const photos = [];
  for (const i of document.querySelectorAll('picture.photo img')) {
    const rect = i.getBoundingClientRect();
    if (!i.complete || i.naturalWidth === 0 || rect.width === 0) continue;
    const srcset = i.parentElement.querySelector('source')?.getAttribute('srcset') ?? '';
    const hit = srcset.split(',').map((s) => s.trim().split(/\s+/)).find(([url]) => new URL(url, location.href).href === i.currentSrc);
    let fileWidth = hit ? Number.parseInt(hit[1], 10) : 0;
    if (!fileWidth) fileWidth = (await createImageBitmap(await (await fetch(i.currentSrc)).blob())).width;
    photos.push({ naturalWidth: fileWidth, renderedWidth: rect.width, srcset, src: i.currentSrc });
  }
  return { cls: window.__cls ?? 0, photos };
}

const CLS_OBSERVER = () => {
  window.__cls = 0;
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
  }).observe({ type: 'layout-shift', buffered: true });
};

async function main() {
  let opts;
  try {
    opts = parseFitArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`${e.message}\n${HELP}`);
    return EXIT.FAIL;
  }
  if (opts.help) {
    console.log(HELP);
    return EXIT.PASS;
  }
  if (opts.from) {
    const result = evaluate(JSON.parse(readFileSync(resolve(opts.from), 'utf8')));
    console.log(formatTable(result.rows));
    if (result.failures.length) console.log(`\n${result.failures.map((f) => `- ${f}`).join('\n')}`);
    console.log(verdictLine(result.exitCode));
    return result.exitCode;
  }
  const chrome = findChrome();
  if (!chrome) {
    console.log(SKIPPED_MESSAGE);
    console.log(verdictLine(EXIT.SKIPPED));
    return EXIT.SKIPPED;
  }
  const dist = resolve(opts.dist);
  if (!existsSync(join(dist, 'index.html'))) {
    console.error(`${dist} has no index.html; run: npm run build -w apps/web`);
    return EXIT.FAIL;
  }
  const { default: puppeteer } = await import('puppeteer-core');
  const { server, origin } = await listen(createDistServer(dist));
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
    if (opts.placeholders) return await placeholderShots(browser, origin, opts);
    const measurements = [];
    for (const route of opts.routes) {
      for (const width of opts.widths) {
        for (const dpr of opts.dprs) {
          const page = await browser.newPage();
          await page.evaluateOnNewDocument(CLS_OBSERVER);
          await page.setViewport({ width, height: 900, deviceScaleFactor: dpr });
          await page.goto(origin + route, { waitUntil: 'networkidle0' });
          await scrollThrough(page);
          const m = await page.evaluate(measurePage);
          await page.close();
          measurements.push({ route, width, dpr, cls: m.cls, photos: m.photos.map((p) => ({ ...p, tiers: srcsetWidths(p.srcset) })) });
        }
      }
    }
    if (opts.json) writeFileSync(resolve(opts.json), `${JSON.stringify(measurements, null, 2)}\n`);
    const result = evaluate(measurements);
    console.log(formatTable(result.rows));
    if (result.failures.length) console.log(`\n${result.failures.map((f) => `- ${f}`).join('\n')}`);
    console.log(verdictLine(result.exitCode));
    return result.exitCode;
  } catch (e) {
    console.error(`image-fit error: ${e.message}`);
    return EXIT.FAIL;
  } finally {
    await browser?.close();
    server.close();
  }
}

// Image requests are held back (never answered) so every photo shows only its dominant-colour block.
async function placeholderShots(browser, origin, opts) {
  const out = resolve(opts.placeholders);
  mkdirSync(out, { recursive: true });
  for (const route of opts.routes) {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (req.resourceType() === 'image') return; // never answered: no pixels, only the placeholder
      req.continue();
    });
    await page.setViewport({ width: opts.widths[0] ?? 412, height: 900 });
    await page.goto(origin + route, { waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 600));
    const name = route.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home';
    const file = join(out, `placeholders-${name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log(`wrote ${file}`);
    await page.close().catch(() => {});
  }
  return EXIT.PASS;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
