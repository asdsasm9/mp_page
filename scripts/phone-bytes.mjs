// phone-bytes: real image bytes a phone downloads on first paint of a page (eager + lazy images that enter the first viewport).
// The budget gate counts only eager images, so this measures what the network really carries.
// Usage: CHROME_PATH=/path/to/chrome node scripts/phone-bytes.mjs [--route /svatby/sedlakovi/] [--dist apps/web/dist]
// Phone: 412x915 CSS px, DPR 1.75 and 3. Counts encoded (gzip/transfer) bytes of image responses after load settles.
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { findChrome } from './design-check.mjs';
import { SKIPPED_MESSAGE } from './design-check-lib.mjs';
import { createDistServer, listen } from './serve-dist.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const routes = args.includes('--route') ? [opt('--route')] : ['/svatby/sedlakovi/', '/svatby/frankovi/'];
const dist = resolve(opt('--dist', 'apps/web/dist'));
const chrome = findChrome();
if (!chrome) {
  console.log(SKIPPED_MESSAGE);
  process.exit(2);
}
if (!existsSync(join(dist, 'index.html'))) {
  console.error(`${dist} has no index.html; run: npm run build -w apps/web`);
  process.exit(1);
}
const { default: puppeteer } = await import('puppeteer-core');
const { server, origin } = await listen(createDistServer(dist));
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
try {
  for (const route of routes) {
    for (const dpr of [1.75, 3]) {
      const page = await browser.newPage();
      await page.setViewport({ width: 412, height: 915, deviceScaleFactor: dpr, isMobile: true, hasTouch: true });
      const cdp = await page.createCDPSession();
      await cdp.send('Network.enable');
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      const imgs = new Map();
      cdp.on('Network.responseReceived', (e) => {
        if (e.type === 'Image') imgs.set(e.requestId, { url: new URL(e.response.url).pathname, bytes: 0 });
      });
      cdp.on('Network.loadingFinished', (e) => {
        if (imgs.has(e.requestId)) imgs.get(e.requestId).bytes = e.encodedDataLength;
      });
      await page.goto(origin + route, { waitUntil: 'networkidle0' });
      const list = [...imgs.values()];
      const total = list.reduce((s, i) => s + i.bytes, 0);
      console.log(`${route} 412x915 DPR ${dpr}: ${list.length} image requests, ${total} bytes (${(total / 1024).toFixed(0)} KB)`);
      for (const i of list) console.log(`  ${i.bytes}\t${i.url}`);
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
