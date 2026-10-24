// lightbox-a11y: keyboard, reduced motion, axe and CDP touch checks of the album lightbox (WP3b steps 16 and 17).
// Needs a built apps/web/dist and Chrome (puppeteer-core, no download). Same server and Chrome finder as lightbox-network.
//   desktop: keyboard-only open / zoom / pan / zoom out / close, announcement, Tab trap, wheel, reduced motion, axe
//   touch:   CDP Input.dispatchTouchEvent double-tap, pinch-in, pan, cancel, photo change (390 px phone viewport)
// Usage: CHROME_PATH=/path/to/chrome npm run lightbox-a11y [-- --route /svatby/frankovi/ --dist apps/web/dist]
// Exit 0 pass, 1 fail, 2 skipped (no Chrome).
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { findChrome } from './design-check.mjs';
import { SKIPPED_MESSAGE } from './design-check-lib.mjs';
import { createDistServer, listen } from './serve-dist.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const route = opt('--route', '/svatby/frankovi/');
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
const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

// The dev images have no master file: answer a master request with the 1600 JPEG of the same photo (as lightbox-network).
const distServer = createDistServer(dist);
const serveDist = distServer.listeners('request')[0];
distServer.removeAllListeners('request');
distServer.on('request', (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  // Dev images are .webp and may lack a 1600 tier: use the largest tier that exists as the stand-in.
  const stand = ['1600.jpg', '1600.webp', '960.webp', '720.webp', '480.webp']
    .map((t) => join(dist, path.replace(/master\.jpg$/, t)))
    .find((p) => existsSync(p));
  if (path.endsWith('/master.jpg') && stand) {
    res.writeHead(200, { 'content-type': stand.endsWith('.webp') ? 'image/webp' : 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable' });
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The zoom view as the page applied it (inline custom properties on the stage). */
const readView = (page) =>
  page.$eval('[data-lb="stage"]', (s) => ({
    scale: Number(s.style.getPropertyValue('--lb-scale') || 1),
    x: parseFloat(s.style.getPropertyValue('--lb-x') || '0'),
    y: parseFloat(s.style.getPropertyValue('--lb-y') || '0'),
    gesture: s.hasAttribute('data-gesture'),
    zoomed: s.hasAttribute('data-zoomed'),
  }));
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const fmt = (v) => `scale ${v.scale.toFixed(3)} x ${v.x.toFixed(1)} y ${v.y.toFixed(1)}`;

async function ready(page) {
  await page.waitForFunction(() => {
    const i = document.querySelector('[data-lb="img"]');
    return i.complete && i.naturalWidth > 0 && !document.querySelector('[data-lb="zoom"]').hidden;
  }, { timeout: 30000 });
}

/** Largest allowed scale of the open photo, computed like the page does (min(4, master width / fit width)). */
const maxScaleOf = (page) =>
  page.evaluate(() => {
    const stage = document.querySelector('[data-lb="stage"]');
    const idx = Number(document.querySelector('[data-lb="count"]').textContent.split('/')[0]) - 1;
    const a = document.querySelectorAll('a[data-lb-item]')[idx];
    const mw = Number(a.dataset.lbMw);
    const mh = Number(a.dataset.lbMh);
    const k = Math.min(stage.clientWidth / mw, stage.clientHeight / mh);
    return Math.min(4, mw / (mw * k));
  });

const inDialog = (page) => page.evaluate(() => !!document.activeElement?.closest('dialog[data-lightbox]'));
// A modal dialog wraps Tab through the browser UI: for one press nothing in the page has focus (document.body).
// That is the native trap working; what must never happen is focus landing on an element behind the dialog.
const behindDialog = (page) =>
  page.evaluate(() => {
    const a = document.activeElement;
    return !!a && a !== document.body && a !== document.documentElement && !a.closest('dialog[data-lightbox]');
  });
const activeName = (page) => page.evaluate(() => document.activeElement?.getAttribute('data-lb') ?? document.activeElement?.tagName ?? '');

try {
  // ------------------------------------------------------------------ desktop, keyboard only
  const page = await browser.newPage();
  // 600x700: a narrow desktop window, so the dev photos (1600 px masters) leave room to zoom in.
  await page.setViewport({ width: 600, height: 700, deviceScaleFactor: 1 });
  await page.goto(origin + route, { waitUntil: 'networkidle0' });

  const meta = await page.$eval('meta[name="viewport"]', (m) => m.content);
  check(!/user-scalable\s*=\s*(no|0)/i.test(meta) && !/maximum-scale\s*=\s*(1(\.0+)?|0?\.\d+)\b/i.test(meta), `viewport meta does not block user scaling (${meta})`);
  check((await page.$$('dialog[data-lightbox] [tabindex]')).length === 0, 'no tabindex attributes inside the dialog (no extra focus loops)');

  await page.focus('a[data-lb-item]');
  await page.keyboard.press('Enter');
  await ready(page);
  check(await page.$eval('dialog[data-lightbox]', (d) => d.open), 'Enter on the focused thumbnail opens the lightbox');
  check(await inDialog(page), `focus moved into the dialog on open (on "${await activeName(page)}")`);
  const count0 = await page.$eval('[data-lb="count"]', (c) => c.textContent);

  // Tab trap at fit: forward and backward, every stop inside the dialog; every control reachable.
  const stops = new Set();
  let leaked = 0;
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press('Tab');
    if (await behindDialog(page)) leaked++;
    stops.add(await activeName(page));
  }
  for (let i = 0; i < 6; i++) {
    await page.keyboard.down('Shift');
    await page.keyboard.press('Tab');
    await page.keyboard.up('Shift');
    if (await behindDialog(page)) leaked++;
    stops.add(await activeName(page));
  }
  check(leaked === 0, `Tab / Shift+Tab never reaches the page behind the dialog at fit (20 presses, stops: ${[...stops].join(', ')}; BODY = native wrap)`);
  for (const name of ['close', 'prev', 'next', 'zoom-in', 'zoom-out', 'zoom-fit']) {
    check(stops.has(name), `Tab reaches "${name}" at fit`);
  }
  check((await page.$eval('[data-lb="prev"]', (b) => b.getAttribute('aria-disabled'))) === 'true', 'first photo: "prev" is aria-disabled (and still focusable)');
  check((await page.$eval('[data-lb="zoom-out"]', (b) => b.getAttribute('aria-disabled'))) === 'true', 'at fit: "zoom out" is aria-disabled');

  // Put focus on the close button so the zoom keys are pressed with a real focused control that must not change.
  await page.focus('[data-lb="close"]');
  const focusBefore = await activeName(page);
  await page.keyboard.press('+');
  await page.waitForFunction(() => document.querySelector('[data-lb="level"]').textContent !== '', { timeout: 5000 }).catch(() => {});
  const level = await page.$eval('[data-lb="level"]', (l) => ({ text: l.textContent, live: l.getAttribute('aria-live'), role: l.getAttribute('role') }));
  let v = await readView(page);
  console.log(`after "+": ${fmt(v)}, announcement "${level.text}"`);
  const max = await maxScaleOf(page);
  console.log(`desktop 600x700: max scale ${max.toFixed(2)}`);
  check(max >= 2.4, `desktop: photo allows at least 2.4x so the key steps below are not clamped (max ${max.toFixed(2)})`);
  check(near(v.scale, 1.5, 0.001), `"+" zooms to 150 % (scale ${v.scale})`);
  check(level.text === 'Přiblížení 150 %', `polite announcement "${level.text}"`);
  check(level.live === 'polite' && level.role === 'status', 'the announcement region is role=status, aria-live=polite');
  check((await activeName(page)) === focusBefore, `zooming does not move focus (still "${focusBefore}")`);
  check(await page.$eval('dialog[data-lightbox] [data-lb="zoom-out"]', (b) => b.getAttribute('aria-disabled') === 'false'), 'zoomed: "zoom out" is enabled');
  check((await page.$eval('[data-lb="stage"]', (s) => getComputedStyle(s).touchAction)) === 'none', 'zoom-capable stage has touch-action: none');

  // Plain wheel does nothing; ctrl+wheel zooms.
  await page.mouse.move(300, 350);
  const beforeWheel = await readView(page);
  await page.mouse.wheel({ deltaY: 120 });
  await sleep(150);
  const afterWheel = await readView(page);
  check(afterWheel.scale === beforeWheel.scale && afterWheel.x === beforeWheel.x, 'plain wheel does nothing');
  await page.keyboard.down('Control');
  await page.mouse.wheel({ deltaY: -30 });
  await page.keyboard.up('Control');
  await sleep(150);
  const afterCtrl = await readView(page);
  check(afterCtrl.scale > beforeWheel.scale + 0.05, `ctrl+wheel zooms in (${beforeWheel.scale.toFixed(2)} -> ${afterCtrl.scale.toFixed(2)})`);

  // Tab trap while zoomed: buttons stay reachable, nothing behind the dialog gets focus.
  const zstops = new Set();
  let zleaked = 0;
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press('Tab');
    if (await behindDialog(page)) zleaked++;
    zstops.add(await activeName(page));
  }
  check(zleaked === 0 && ['close', 'prev', 'next'].every((n) => zstops.has(n)), `zoomed: Tab never reaches the page behind and reaches close/prev/next (stops: ${[...zstops].join(', ')})`);

  // Zoom to the maximum so there is room to pan on both axes, then pan by keyboard.
  await page.keyboard.press('0');
  for (let i = 0; i < 6; i++) await page.keyboard.press('+');
  v = await readView(page);
  check(near(v.scale, max, 0.001), `"+" repeated stops at the maximum (${v.scale.toFixed(3)} / ${max.toFixed(3)})`);
  check(await page.$eval('[data-lb="zoom-in"]', (b) => b.getAttribute('aria-disabled') === 'true'), 'at the maximum "zoom in" is aria-disabled');
  await page.keyboard.press('ArrowRight');
  v = await readView(page);
  const expectedStep = Math.round(Math.min(600, 700) * 0.2);
  console.log(`after ArrowRight while zoomed: ${fmt(v)}`);
  check(v.x < 0 && near(v.x, -expectedStep, 1), `zoomed: ArrowRight pans the image left by ${expectedStep} px (x ${v.x})`);
  check((await page.$eval('[data-lb="count"]', (c) => c.textContent)) === count0, 'zoomed: ArrowRight did not change the photo');
  await page.keyboard.press('ArrowLeft');
  v = await readView(page);
  check(near(v.x, 0, 1), `zoomed: ArrowLeft pans back (x ${v.x})`);
  for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowDown');
  const vDown = await readView(page);
  await page.keyboard.press('ArrowDown');
  const vDown2 = await readView(page);
  check(vDown.y === vDown2.y, `pan is clamped at the edge (y ${vDown.y})`);

  // axe on the open and zoomed dialog.
  await page.evaluate(axeSource);
  const runAxe = (label) =>
    page.evaluate(async () => {
      const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } });
      return r.violations.map((x) => ({ id: x.id, impact: x.impact, nodes: x.nodes.length, target: x.nodes[0]?.target?.join(' ') }));
    }).then((list) => {
      const bad = list.filter((x) => x.impact === 'serious' || x.impact === 'critical');
      for (const x of list) console.log(`  axe ${label}: ${x.impact} ${x.id} (${x.nodes}) ${x.target}`);
      check(bad.length === 0, `axe ${label}: ${bad.length} serious/critical violations (${list.length} total)`);
    });
  await runAxe('zoomed dialog');
  await page.keyboard.press('0');
  await runAxe('open dialog at fit');

  // Photo change resets the zoom; zoom out; keyboard prev/next at fit.
  await page.keyboard.press('0');
  await page.keyboard.press('+');
  await page.keyboard.press('+');
  await page.keyboard.press('-');
  await page.keyboard.press('+');
  v = await readView(page);
  check(near(v.scale, 2.25, 0.001), `"+" "+" "-" from fit -> 225 % (scale ${v.scale.toFixed(3)})`);
  await page.keyboard.press('0');
  check(near((await readView(page)).scale, 1, 0.001), '"0" returns to fit');
  await page.keyboard.press('ArrowRight');
  check((await page.$eval('[data-lb="count"]', (c) => c.textContent)) !== count0, 'at fit: ArrowRight goes to the next photo');
  await page.keyboard.press('ArrowLeft');

  // Keyboard-only close, focus back to the opener.
  await page.keyboard.press('+');
  await page.keyboard.press('Escape');
  check(!(await page.$eval('dialog[data-lightbox]', (d) => d.open)), 'Escape closes the dialog even when zoomed');
  const opener = await page.evaluate(() => document.activeElement === document.querySelector('a[data-lb-item]'));
  check(opener, 'focus returned to the opener thumbnail');

  // Reopen by keyboard from a later thumbnail: focus must return to that one.
  const third = await page.evaluate(() => {
    const a = document.querySelectorAll('a[data-lb-item]')[2];
    a.focus();
    return !!a;
  });
  await page.keyboard.press('Enter');
  await ready(page);
  await page.click('[data-lb="close"]');
  check(third && (await page.evaluate(() => document.activeElement === document.querySelectorAll('a[data-lb-item]')[2])), 'close button: focus returns to the thumbnail that opened it (3rd)');

  // Reduced motion: computed transition on the transform is none.
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await page.click('a[data-lb-item]');
  await ready(page);
  const normal = await page.$eval('[data-lb="img"]', (i) => getComputedStyle(i).transitionDuration);
  await page.keyboard.press('Escape');
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.click('a[data-lb-item]');
  await ready(page);
  await page.keyboard.press('+');
  const reduced = await page.$eval('[data-lb="img"]', (i) => {
    const c = getComputedStyle(i);
    return { property: c.transitionProperty, duration: c.transitionDuration };
  });
  const dialogAnim = await page.$eval('dialog[data-lightbox]', (d) => getComputedStyle(d).animationName);
  console.log(`transition: no-preference "${normal}", reduce ${JSON.stringify(reduced)}, dialog animation under reduce "${dialogAnim}"`);
  check(normal !== '0s' && normal !== '', `sanity: without the preference the transform transition runs (${normal})`);
  check(reduced.property === 'none' || /^0s(, 0s)*$/.test(reduced.duration), `reduced motion: computed transition is none (${reduced.property} / ${reduced.duration})`);
  check(dialogAnim === 'none', 'reduced motion: no open animation');
  await page.keyboard.press('Escape');
  await page.close();

  // ------------------------------------------------------------------ touch, CDP
  const phone = await browser.newPage();
  await phone.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await phone.goto(origin + route, { waitUntil: 'networkidle0' });
  const cdp = await phone.createCDPSession();
  const touch = (type, points) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id, radiusX: 1, radiusY: 1, force: 1 })) });
  const tapAt = async (x, y) => {
    await touch('touchStart', [[x, y]]);
    await sleep(30);
    await touch('touchEnd', []);
  };

  await phone.tap('a[data-lb-item]');
  await ready(phone);
  const phoneMax = await maxScaleOf(phone);
  const cx = 195;
  const cy = await phone.$eval('[data-lb="stage"]', (s) => s.getBoundingClientRect().height / 2);
  console.log(`touch: stage centre ${cx},${cy.toFixed(0)}, max scale ${phoneMax.toFixed(2)}`);
  check(phoneMax >= 2, `touch: photo allows at least 2x (max ${phoneMax.toFixed(2)}), so the expected values below are meaningful`);

  // Double tap zooms to min(2, max) and a second double tap returns to fit.
  await tapAt(cx, cy);
  await sleep(90);
  await tapAt(cx, cy);
  await sleep(300);
  v = await readView(phone);
  const want2 = Math.min(2, phoneMax);
  check(near(v.scale, want2, 0.02), `double-tap zooms to ${want2.toFixed(2)} (${fmt(v)})`);
  check(near(v.x, 0, 1.5) && near(v.y, 0, 1.5), `double-tap at the centre keeps the centre (x ${v.x.toFixed(1)}, y ${v.y.toFixed(1)})`);
  await tapAt(cx, cy);
  await sleep(90);
  await tapAt(cx, cy);
  await sleep(300);
  v = await readView(phone);
  check(near(v.scale, 1, 0.001), `second double-tap returns to fit (${fmt(v)})`);
  // Two slow taps are not a double tap.
  await tapAt(cx, cy);
  await sleep(450);
  await tapAt(cx, cy);
  await sleep(200);
  check(near((await readView(phone)).scale, 1, 0.001), 'two taps 450 ms apart do not zoom');
  // Two taps far apart are not a double tap.
  await tapAt(100, cy);
  await sleep(80);
  await tapAt(300, cy);
  await sleep(200);
  check(near((await readView(phone)).scale, 1, 0.001), 'two taps 200 px apart do not zoom');

  // Pinch-in: fingers 100 px apart -> 200 px apart gives 2x.
  await touch('touchStart', [[cx - 50, cy], [cx + 50, cy]]);
  for (let i = 1; i <= 10; i++) {
    const half = 50 + i * 5;
    await touch('touchMove', [[cx - half, cy], [cx + half, cy]]);
    await sleep(16);
  }
  v = await readView(phone);
  check(v.gesture, 'during the pinch the transform transition is off (data-gesture)');
  await touch('touchEnd', []);
  await sleep(100);
  v = await readView(phone);
  check(near(v.scale, Math.min(2, phoneMax), 0.05), `pinch-in 100 -> 200 px gives ${Math.min(2, phoneMax).toFixed(2)}x (${fmt(v)})`);
  check(near(v.x, 0, 2) && near(v.y, 0, 2), `centred pinch keeps the photo centred (x ${v.x.toFixed(1)}, y ${v.y.toFixed(1)})`);
  check(!v.gesture, 'after the pinch the gesture flag is cleared');

  // One-finger pan: drag 50 px left and 20 px up.
  const beforePan = await readView(phone);
  await touch('touchStart', [[cx, cy]]);
  for (let i = 1; i <= 5; i++) {
    await touch('touchMove', [[cx - i * 10, cy - i * 4]]);
    await sleep(16);
  }
  await touch('touchEnd', []);
  await sleep(100);
  v = await readView(phone);
  console.log(`pan: ${fmt(beforePan)} -> ${fmt(v)}`);
  check(near(v.x - beforePan.x, -50, 3), `one-finger pan moves x by -50 px (${(v.x - beforePan.x).toFixed(1)})`);
  check(v.y - beforePan.y <= 0 && v.y - beforePan.y >= -21, `one-finger pan moves y up, within the clamp (${(v.y - beforePan.y).toFixed(1)})`);
  check(near(v.scale, beforePan.scale, 0.001), 'panning does not change the scale');

  // Pan far beyond the edge: clamped (no edge exposed).
  // (Away from the vertical middle: the prev/next buttons sit there at the edges and would take the touch.)
  await touch('touchStart', [[cx + 150, cy + 150]]);
  for (let i = 1; i <= 12; i++) {
    await touch('touchMove', [[cx + 150 - i * 30, cy + 150]]);
    await sleep(8);
  }
  await touch('touchEnd', []);
  await sleep(100);
  v = await readView(phone);
  console.log(`far pan: ${fmt(v)}`);
  const limitX = await phone.$eval('[data-lb="stage"]', (s) => {
    const idx = Number(document.querySelector('[data-lb="count"]').textContent.split('/')[0]) - 1;
    const a = document.querySelectorAll('a[data-lb-item]')[idx];
    const mw = Number(a.dataset.lbMw);
    const mh = Number(a.dataset.lbMh);
    const k = Math.min(s.clientWidth / mw, s.clientHeight / mh);
    const sc = Number(s.style.getPropertyValue('--lb-scale'));
    return Math.max(0, (mw * k * sc - s.clientWidth) / 2);
  });
  check(near(Math.abs(v.x), limitX, 0.5), `pan far past the edge stops exactly at the clamp: |x| ${Math.abs(v.x).toFixed(1)} == ${limitX.toFixed(1)}`);

  // touchCancel in the middle of a drag and of a pinch ends the gesture cleanly.
  await touch('touchStart', [[cx, cy]]);
  await touch('touchMove', [[cx - 20, cy]]);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await sleep(100);
  v = await readView(phone);
  check(!v.gesture, 'touchCancel during a drag clears the gesture state');
  await touch('touchStart', [[cx - 50, cy], [cx + 50, cy]]);
  await touch('touchMove', [[cx - 60, cy], [cx + 60, cy]]);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await sleep(100);
  v = await readView(phone);
  check(!v.gesture, 'touchCancel during a pinch clears the gesture state');

  // Photo change: back to fit, no stale pointers, gestures still work on the new photo.
  await phone.tap('[data-lb="next"]');
  await sleep(300);
  v = await readView(phone);
  check(near(v.scale, 1, 0.001) && v.x === 0 && v.y === 0 && !v.gesture, `next photo starts at fit (${fmt(v)})`);
  await ready(phone);
  await tapAt(cx, cy);
  await sleep(90);
  await tapAt(cx, cy);
  await sleep(300);
  v = await readView(phone);
  check(v.scale > 1.5, `double-tap works on the second photo (${fmt(v)})`);
  await touch('touchStart', [[cx - 50, cy], [cx + 50, cy]]);
  await touch('touchMove', [[cx - 40, cy], [cx + 40, cy]]);
  await touch('touchEnd', []);
  await sleep(100);
  v = await readView(phone);
  check(v.scale < 2 && v.scale > 1, `pinch-out on the second photo reduces the zoom (${fmt(v)})`);
  // The button alternatives still work.
  await phone.tap('[data-lb="zoom-fit"]');
  await sleep(100);
  check(near((await readView(phone)).scale, 1, 0.001), 'the "1x" button returns to fit');

  // T-291: nothing in the lightbox may start a browser pinch of the page, and if the page is zoomed anyway the
  // controls must follow the visible window so the user can always close.
  const touchActions = await phone.$$eval('dialog[data-lightbox], [data-lb="stage"], [data-lb="close"], [data-lb="prev"], [data-lb="next"], [data-lb="zoom-in"]', (els) => els.map((e) => getComputedStyle(e).touchAction));
  check(touchActions.slice(0, 2).every((t) => t === 'none'), `dialog and stage refuse browser pan/pinch (${touchActions.slice(0, 2).join(', ')})`);
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2.5 });
  await sleep(300);
  const pageZoom = await phone.evaluate(() => ({
    scale: window.visualViewport.scale,
    flagged: document.querySelector('dialog[data-lightbox]').hasAttribute('data-page-zoomed'),
  }));
  console.log(`page zoom emulation: scale ${pageZoom.scale.toFixed(2)}, dialog flagged ${pageZoom.flagged}`);
  check(pageZoom.scale > 2, `page scale emulation took effect (${pageZoom.scale.toFixed(2)})`);
  const insideWindow = async (name) =>
    phone.$eval(`[data-lb="${name}"]`, (el) => {
      const r = el.getBoundingClientRect();
      const vv = window.visualViewport;
      // getBoundingClientRect is in layout coordinates; the visible window is offset by the visual viewport.
      return r.left >= vv.offsetLeft - 1 && r.top >= vv.offsetTop - 1 && r.right <= vv.offsetLeft + vv.width + 1 && r.bottom <= vv.offsetTop + vv.height + 1;
    });
  check(pageZoom.flagged, 'a zoomed page flags the dialog (data-page-zoomed)');
  for (const name of ['close', 'prev', 'next', 'count']) {
    check(await insideWindow(name), `page-zoomed: ${name} stays inside the visible window`);
  }
  const closeSize = await phone.$eval('[data-lb="close"]', (el) => {
    const r = el.getBoundingClientRect();
    return r.width * window.visualViewport.scale;
  });
  check(closeSize >= 43.5, `page-zoomed: the close button is still about 44 px on screen (${closeSize.toFixed(1)})`);
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
  await sleep(300);
  check(!(await phone.$eval('dialog[data-lightbox]', (d) => d.hasAttribute('data-page-zoomed'))), 'back at page scale 1 the dialog is unflagged');
  await phone.tap('[data-lb="close"]');
  await sleep(200);
  check(!(await phone.$eval('dialog[data-lightbox]', (d) => d.open)), 'the close button closes the lightbox');
  await phone.close();
} catch (e) {
  failures.push(`error: ${e.message}`);
  console.error(e);
} finally {
  await browser.close();
  server.close();
}
console.log(failures.length ? `LIGHTBOX_A11Y: FAIL\n${failures.map((f) => `- ${f}`).join('\n')}` : 'LIGHTBOX_A11Y: PASS');
process.exit(failures.length ? 1 : 0);
