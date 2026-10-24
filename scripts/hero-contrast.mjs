// hero-contrast: measures the contrast of the home hero text (kicker, h1, button) against the RENDERED pixels behind it.
// For each width the hero text is made transparent, the page is screenshotted, and every pixel under each text box is
// compared with the text colour (same relative-luminance formula as tokens.test.ts). It runs with the real hero and
// again with the hero image replaced by pure white (the brightest possible photo, so the worst case for light text).
// Needs apps/web/dist. Usage: node scripts/hero-contrast.mjs [--out dir]
// Limits: kicker and button label need 4.5, the h1 (large text) needs 3. Exit 0 pass, 1 fail.
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { findChrome } from './design-check.mjs';
import { createDistServer, listen } from './serve-dist.mjs';

const WIDTHS = [360, 768, 1280, 1920];
const LIMITS = { kicker: 4.5, h1: 3, button: 4.5 };
const out = resolve(process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : '.tmp/hero-contrast');

const lin = (c) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

async function measure(browser, origin, width, variant) {
  const page = await browser.newPage();
  await page.setViewport({ width, height: 900 });
  await page.goto(`${origin}/`, { waitUntil: 'networkidle0' });
  if (variant === 'white') {
    await page.evaluate(() => {
      const img = document.querySelector('#uvod img');
      document.querySelectorAll('#uvod source').forEach((s) => s.remove());
      img.removeAttribute('srcset');
      img.src = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#fff"/></svg>')}`;
    });
    await page.evaluate(() => new Promise((r) => setTimeout(r, 200)));
  }
  const boxes = await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = 'auto';
    scrollTo(0, 0);
    const pick = (sel) => {
      const el = document.querySelector(sel);
      const r = el.getBoundingClientRect();
      // Per-line boxes for the h1 (a wrapped heading is not a full rectangle)
      const range = document.createRange();
      range.selectNodeContents(el);
      const rects = [...range.getClientRects()].filter((q) => q.width > 1);
      return { color: getComputedStyle(el).color, rects: (rects.length ? rects : [r]).map((q) => ({ x: q.x, y: q.y, w: q.width, h: q.height })) };
    };
    return { kicker: pick('#uvod .kicker'), h1: pick('#uvod h1'), button: pick('#uvod .btn') };
  });
  // CSSOM writes (not a <style> tag, which the CSP blocks): hide the text, the button frame and the kicker rule
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('#uvod .text *')) {
      el.style.setProperty('color', 'transparent', 'important');
      el.style.setProperty('background', 'transparent', 'important');
      el.style.setProperty('border-color', 'transparent', 'important');
    }
  });
  await page.evaluate(() => new Promise((r) => setTimeout(r, 400))); // .btn colour transitions must finish before the shot
  const png =await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width, height: 900 } });
  await page.screenshot({ path: join(out, `hero-${variant}-${width}.png`), clip: { x: 0, y: 0, width, height: 900 } });
  await page.close();
  const { default: sharp } = await import('sharp');
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const results = {};
  for (const [name, { color, rects }] of Object.entries(boxes)) {
    const fg = color.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
    let worst = Infinity;
    for (const q of rects) {
      for (let y = Math.max(0, Math.floor(q.y)); y < Math.min(info.height, Math.ceil(q.y + q.h)); y += 2) {
        for (let x = Math.max(0, Math.floor(q.x)); x < Math.min(info.width, Math.ceil(q.x + q.w)); x += 2) {
          const i = (y * info.width + x) * 3;
          worst = Math.min(worst, ratio(fg, [data[i], data[i + 1], data[i + 2]]));
        }
      }
    }
    results[name] = worst;
  }
  return results;
}

async function main() {
  const chrome = findChrome();
  if (!chrome) {
    console.log('HERO_CONTRAST: SKIPPED (no Chrome)');
    return 2;
  }
  const dist = resolve('apps/web/dist');
  if (!existsSync(join(dist, 'index.html'))) {
    console.error('no apps/web/dist; build first');
    return 1;
  }
  mkdirSync(out, { recursive: true });
  const { default: puppeteer } = await import('puppeteer-core');
  const { server, origin } = await listen(createDistServer(dist));
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
  let failed = false;
  try {
    for (const variant of ['hero', 'white']) {
      for (const width of WIDTHS) {
        const r = await measure(browser, origin, width, variant);
        const parts = Object.entries(r).map(([k, v]) => {
          const ok = v >= LIMITS[k];
          if (!ok) failed = true;
          return `${k}=${v.toFixed(2)}${ok ? '' : ` (<${LIMITS[k]})`}`;
        });
        console.log(`${variant} ${width}: ${parts.join(' ')}`);
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`HERO_CONTRAST: ${failed ? 'FAIL' : 'PASS'}`);
  return failed ? 1 : 0;
}

process.exit(await main());
