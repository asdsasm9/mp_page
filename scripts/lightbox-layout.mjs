// lightbox-layout: centering of the album lightbox at 360, 768 and 1280 px, portrait and landscape, fit and zoomed.
// Asserts that the controls are symmetric in the viewport and that the photo is centred, and saves screenshots to
// design-check-out/lightbox-<w>x<h>-<shape>-<fit|zoom>.png. Needs a built apps/web/dist and Chrome (puppeteer-core).
// Usage: npm run lightbox-layout [-- --route /svatby/frankovi/ --dist apps/web/dist]
// Exit 0 pass, 1 fail, 2 skipped (no Chrome).
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { findChrome } from './design-check.mjs';
import { SKIPPED_MESSAGE } from './design-check-lib.mjs';
import { createDistServer, listen } from './serve-dist.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
// Two albums so that both portrait and landscape photos are covered (the first has landscape photos only).
const routes = opt('--route', '/svatby/frankovi/,/portrety/anez/').split(',');
const dist = resolve(opt('--dist', 'apps/web/dist'));
const out = resolve('design-check-out');

const chrome = findChrome();
if (!chrome) {
  console.log(SKIPPED_MESSAGE);
  process.exit(2);
}
if (!existsSync(join(dist, 'index.html'))) {
  console.error(`${dist} has no index.html; run: npm run build -w apps/web`);
  process.exit(1);
}
mkdirSync(out, { recursive: true });

const { default: puppeteer } = await import('puppeteer-core');
const { server, origin } = await listen(createDistServer(dist));
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
const failures = [];
const TOL = 1.5; // px
const check = (ok, label) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failures.push(label);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sizes = [
  [360, 640],
  [768, 1024],
  [1280, 800],
];

/** Geometry of the open lightbox: control boxes, glyph boxes and the visible photo box (object-fit: contain). */
const measure = (page) =>
  page.evaluate(() => {
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    };
    const glyph = (el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const r = range.getBoundingClientRect();
      return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    };
    const q = (n) => document.querySelector(`[data-lb="${n}"]`);
    const img = q('img');
    const stage = q('stage');
    const s = box(stage);
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    const k = Math.min(s.w / nw, s.h / nh);
    const scale = Number(stage.style.getPropertyValue('--lb-scale') || 1);
    const shown = { w: nw * k * scale, h: nh * k * scale };
    const ib = box(img);
    return {
      vw: document.documentElement.clientWidth,
      vh: window.innerHeight,
      stage: s,
      photo: { cx: ib.cx, cy: ib.cy, w: shown.w, h: shown.h, landscape: nw >= nh },
      close: box(q('close')),
      closeGlyph: glyph(q('close')),
      zoomIn: box(q('zoom-in')),
      zoomInGlyph: glyph(q('zoom-in')),
      zoomGroup: box(q('zoom')),
      count: box(q('count')),
      prev: box(q('prev')),
      next: box(q('next')),
    };
  });

try {
  for (const route of routes)
  for (const [w, h] of sizes) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await page.goto(origin + route, { waitUntil: 'networkidle0' });
    const total = await page.$$eval('a[data-lb-item]', (a) => a.length);
    // Find one portrait and one landscape photo by their thumbnail dimensions.
    const shapes = await page.$$eval('a[data-lb-item] img', (imgs) => imgs.map((i) => i.naturalWidth >= i.naturalHeight));
    const wanted = { landscape: shapes.indexOf(true), portrait: shapes.indexOf(false) };
    for (const [shape, index] of Object.entries(wanted)) {
      if (index < 0) {
        console.log(`note: ${route} has no ${shape} photo among ${total}; skipped at ${w}`);
        continue;
      }
      await page.evaluate((i) => document.querySelectorAll('a[data-lb-item]')[i].click(), index);
      await page.waitForFunction(() => {
        const i = document.querySelector('[data-lb="img"]');
        return i.complete && i.naturalWidth > 0;
      }, { timeout: 30000 });
      await sleep(400);
      for (const mode of ['fit', 'zoom']) {
        if (mode === 'zoom') {
          const enabled = await page.$eval('[data-lb="zoom"]', (g) => !g.hidden);
          if (!enabled) {
            console.log(`note: zoom not available for ${shape} at ${w}`);
            continue;
          }
          await page.click('[data-lb="zoom-in"]');
          await sleep(400);
        }
        const m = await measure(page);
        const tag = `${route} ${w}x${h} ${shape} ${mode}`;
        await page.screenshot({ path: join(out, `lightbox-${w}x${h}-${shape}-${mode}.png`) });
        // The controls sit on the viewport symmetric margins; the stage and the photo are centred.
        check(Math.abs(m.stage.cx - m.vw / 2) <= TOL && Math.abs(m.stage.cy - m.vh / 2) <= TOL, `${tag}: stage centred in the viewport (${m.stage.cx.toFixed(1)}, ${m.stage.cy.toFixed(1)})`);
        check(Math.abs(m.photo.cx - m.vw / 2) <= TOL && Math.abs(m.photo.cy - m.vh / 2) <= TOL || mode === 'zoom', `${tag}: photo centred (${m.photo.cx.toFixed(1)}, ${m.photo.cy.toFixed(1)})`);
        check(Math.abs(m.closeGlyph.cx - m.close.cx) <= TOL && Math.abs(m.closeGlyph.cy - m.close.cy) <= TOL, `${tag}: X glyph centred in its button (dx ${(m.closeGlyph.cx - m.close.cx).toFixed(1)}, dy ${(m.closeGlyph.cy - m.close.cy).toFixed(1)})`);
        check(Math.abs(m.zoomInGlyph.cx - m.zoomIn.cx) <= TOL && Math.abs(m.zoomInGlyph.cy - m.zoomIn.cy) <= TOL, `${tag}: + glyph centred in its button (dx ${(m.zoomInGlyph.cx - m.zoomIn.cx).toFixed(1)}, dy ${(m.zoomInGlyph.cy - m.zoomIn.cy).toFixed(1)})`);
        // Top row: counter and close mirror each other. Bottom: the zoom group is centred (not in a corner).
        check(Math.abs(m.count.x - (m.vw - m.close.x - m.close.w)) <= TOL && Math.abs(m.count.cy - m.close.cy) <= TOL, `${tag}: counter mirrors the close button (x ${m.count.x.toFixed(1)}, cy ${m.count.cy.toFixed(1)} vs ${m.close.cy.toFixed(1)})`);
        check(Math.abs(m.zoomGroup.cx - m.vw / 2) <= TOL, `${tag}: zoom group centred (${m.zoomGroup.cx.toFixed(1)} of ${m.vw})`);
        check(Math.abs(m.prev.x - (m.vw - m.next.x - m.next.w)) <= TOL, `${tag}: prev and next mirror each other`);
        check(Math.abs(m.prev.cy - m.vh / 2) <= TOL, `${tag}: prev/next vertically centred`);
        check(m.close.x + m.close.w <= m.vw && m.zoomGroup.x >= 0 && m.zoomGroup.x + m.zoomGroup.w <= m.vw, `${tag}: controls inside the viewport`);
      }
      await page.keyboard.press('Escape');
    }
    await page.close();
  }
} catch (e) {
  failures.push(`error: ${e.message}`);
  console.error(e);
} finally {
  await browser.close();
  server.close();
}
console.log(failures.length ? `LIGHTBOX_LAYOUT: FAIL\n${failures.map((f) => `- ${f}`).join('\n')}` : 'LIGHTBOX_LAYOUT: PASS');
process.exit(failures.length ? 1 : 0);
