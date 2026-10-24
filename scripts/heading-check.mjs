// Heading hierarchy check (T-323): on every page with a page h1, each main h2 is smaller than that h1
// (and at most ~70% of it from 1280 px up). The home page is skipped: its hero display h1 is not a PageHead h1.
// Usage: npm run heading-check [-- --dist apps/web/dist]. Needs a built apps/web/dist. Exit 0 pass, 1 fail, 2 no Chrome.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { findChrome } from './design-check.mjs';
import { createDistServer, listen } from './serve-dist.mjs';

const ROUTES = ['/portfolio/', '/svatby/', '/svatby/frankovi/', '/o-mne/', '/cookies/'];
const WIDTHS = [360, 1280, 1920];

const i = process.argv.indexOf('--dist');
const dist = resolve(i > -1 ? process.argv[i + 1] : 'apps/web/dist');
const chrome = findChrome();
if (!chrome) {
  console.error('HEADING_CHECK skipped: no Chrome');
  process.exit(2);
}
if (!existsSync(resolve(dist, 'index.html'))) {
  console.error(`${dist} has no index.html; run: npm run build -w apps/web`);
  process.exit(1);
}

const { default: puppeteer } = await import('puppeteer-core');
const { server, origin } = await listen(createDistServer(dist));
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
const failures = [];
try {
  for (const route of ROUTES) {
    for (const w of WIDTHS) {
      const page = await browser.newPage();
      await page.setViewport({ width: w, height: 900 });
      await page.goto(`${origin}${route}`, { waitUntil: 'networkidle0' });
      const { h1, h2s } = await page.evaluate(() => {
        const px = (el) => parseFloat(getComputedStyle(el).fontSize);
        const h1 = document.querySelector('main h1');
        return { h1: h1 ? px(h1) : null, h2s: [...document.querySelectorAll('main h2')].map(px) };
      });
      await page.close();
      if (h1 === null) failures.push(`${route} @${w}: no main h1`);
      for (const h2 of h2s) {
        if (h2 >= h1) failures.push(`${route} @${w}: h2 ${h2}px is not smaller than h1 ${h1}px`);
        else if (w >= 1280 && h2 > h1 * 0.7 + 0.5) failures.push(`${route} @${w}: h2 ${h2}px is over 70% of h1 ${h1}px`);
      }
      console.log(`${route} @${w}: h1 ${h1}px, h2 ${[...new Set(h2s)].join('/') || '-'}px`);
    }
  }
} finally {
  await browser.close();
  server.close();
}
if (failures.length) {
  for (const f of failures) console.error(`FAIL ${f}`);
  process.exit(1);
}
console.log('HEADING_CHECK pass');
