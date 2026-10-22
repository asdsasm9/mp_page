// lightbox-network: does the album lightbox load in stages? Needs a built apps/web/dist and Chrome.
//   page load            -> no master and no 2400 request
//   open (click)         -> the fit tier (1600/2400 WebP) is requested, no master
//   first zoom (+ key)   -> the master is requested exactly once
//   close, reopen, zoom  -> no master request beyond the HTTP cache (the master is dropped on close; immutable headers)
// Usage: CHROME_PATH=/path/to/chrome npm run lightbox-network [-- --route /svatby/frankovi/ --dist apps/web/dist --throttle]
// --throttle adds Chrome network emulation (slow 4G) so the staged swap is observable. Exit 0 pass, 1 fail, 2 skipped.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { findChrome } from './design-check.mjs';
import { SKIPPED_MESSAGE } from './design-check-lib.mjs';
import { createDistServer, listen } from './serve-dist.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const route = opt('--route', '/svatby/frankovi/');
const dist = resolve(opt('--dist', 'apps/web/dist'));
const throttle = args.includes('--throttle');
const shots = opt('--shots', null); // directory for two screenshots of the open lightbox (must exist)

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
// The dev images (scripts/dev-images.ts) have no master file, so the server answers a master request with the 1600
// JPEG of the same photo (a valid, decodable stand-in) and the immutable cache headers the real master gets.
// Every master that reaches the server is recorded in masterHits; a request answered by Chrome's HTTP cache is not.
const masterHits = [];
const distServer = createDistServer(dist);
const serveDist = distServer.listeners('request')[0];
distServer.removeAllListeners('request');
distServer.on('request', (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  const stand = join(dist, path.replace(/master\.jpg$/, '1600.jpg'));
  if (path.endsWith('/master.jpg') && existsSync(stand)) {
    masterHits.push(path);
    res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable' });
    res.end(readFileSync(stand));
  } else {
    serveDist(req, res);
  }
});
const { server, origin } = await listen(distServer);
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
const failures = [];
const check = (ok, label) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failures.push(label);
};

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  if (throttle) {
    const cdp = await page.createCDPSession();
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
  }
  // Image requests the page issued (cache-served ones included); masters that really reached the server are
  // counted separately in masterHits, so "none beyond the cache" is measured where it matters.
  const requests = [];
  page.on('request', (r) => {
    if (r.resourceType() === 'image') requests.push(new URL(r.url()).pathname);
  });
  const isMaster = (p) => p.endsWith('/master.jpg');
  const is2400 = (p) => p.includes('2400');
  const mark = () => requests.length;

  await page.goto(origin + route, { waitUntil: 'networkidle0' });
  check(!requests.some(isMaster), `page load: no master request (${requests.length} image requests)`);
  check(!requests.some(is2400), 'page load: no 2400 request');

  const before = mark();
  await page.click('a[data-lb-item]');
  await page.waitForFunction(() => document.querySelector('[data-lb="img"]').complete && document.querySelector('[data-lb="img"]').naturalWidth > 0, { timeout: 30000 });
  const opened = requests.slice(before);
  const front = await page.$eval('[data-lb="img"]', (i) => ({ src: i.currentSrc, w: i.naturalWidth }));
  console.log(`opened: new image requests ${JSON.stringify(opened)}; front ${front.src}`);
  // Dev photos may lack a 1600/2400 WebP; then the lightbox set holds the largest existing tier (here 960).
  const set = await page.$eval('a[data-lb-item]', (a) => a.dataset.lbSet);
  check(set.includes(new URL(front.src).pathname), `open: the front image is a tier of data-lb-set (${new URL(front.src).pathname.split('/').pop()})`);
  // The fit tier must be requested on open, unless it equals a tier the grid already loaded (dev photos: 960 only);
  // then no further request for it is needed, and it must be served from what the page already requested.
  const frontPath = new URL(front.src).pathname;
  const alreadyLoaded = requests.slice(0, before).includes(frontPath);
  const frontDir = frontPath.slice(0, frontPath.lastIndexOf('/') + 1);
  check(
    alreadyLoaded ? !opened.some((p) => p.startsWith(frontDir)) : opened.includes(frontPath),
    alreadyLoaded ? 'open: the fit tier equals a tier the grid already loaded, so no extra request for that photo is needed' : 'open: the fit tier was requested on open',
  );
  check(!opened.some(isMaster), 'open: no master request');
  check(!(await page.$eval('[data-lb="back"]', (i) => !i.hidden)), 'open: back layer hidden after the front swap');

  const zoomShown = await page.$eval('[data-lb="zoom"]', (g) => !g.hidden);
  console.log(`zoom group visible: ${zoomShown}`);
  const mastersBefore = masterHits.length;
  await page.keyboard.press('+');
  await page.waitForFunction(() => document.querySelector('[data-lb="img"]').currentSrc.endsWith('/master.jpg'), { timeout: 30000 }).catch(() => {});
  const status = await page.$eval('[data-lb="status"]', (s) => s.textContent);
  if (shots) {
    await page.screenshot({ path: join(resolve(shots), 'lightbox-zoomed-1280.png') });
    await page.setViewport({ width: 375, height: 800, deviceScaleFactor: 1 });
    await page.keyboard.press('0');
    await page.screenshot({ path: join(resolve(shots), 'lightbox-open-375.png') });
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  }
  if (zoomShown) {
    check(masterHits.length - mastersBefore === 1, `first zoom: master requested exactly once (${masterHits.length})`);
    check(status === '', `status cleared after the swap (was "${status}")`);
    await page.keyboard.press('+');
    await page.keyboard.press('-');
    await page.keyboard.press('0');
    check(masterHits.length === 1 && requests.filter(isMaster).length === 1, 'further zoom actions: still one master request');
  } else {
    check(masterHits.length === 0, 'no zoom offered: no master request');
  }

  await page.keyboard.press('Escape');
  const afterClose = mark();
  await page.click('a[data-lb-item]');
  await page.waitForFunction(() => document.querySelector('[data-lb="img"]').complete, { timeout: 30000 });
  await page.keyboard.press('+');
  await new Promise((r) => setTimeout(r, 800));
  // The lightbox drops the decoded master on close, so the reopen's zoom asks the browser for it again; the master is
  // served with immutable cache headers, so Chrome's HTTP cache must answer and no request may reach the server.
  // (If headless Chrome ever stops caching, relax this to at most one extra server hit and say so here.)
  const reopenMasters = requests.slice(afterClose).filter(isMaster).length;
  check(masterHits.length === 1, `close, reopen, zoom: no master request beyond the cache (server hits ${masterHits.length}, page-level master requests on reopen ${reopenMasters})`);
  console.log(`reopen: new image requests ${JSON.stringify(requests.slice(afterClose))}`);
  console.log(`master requests that reached the server: ${JSON.stringify(masterHits)}`);
} catch (e) {
  failures.push(`error: ${e.message}`);
  console.error(e);
} finally {
  await browser.close();
  server.close();
}
console.log(failures.length ? `LIGHTBOX_NETWORK: FAIL\n${failures.map((f) => `- ${f}`).join('\n')}` : 'LIGHTBOX_NETWORK: PASS');
process.exit(failures.length ? 1 : 0);
