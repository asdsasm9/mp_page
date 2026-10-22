// admin-check (WP5-28): the admin app in a real Chrome, built with VITE_BACKEND=fake (in-memory world, no network).
// Drives the flows F1-F6 of docs/ADMIN-UX.md with failure injection at desktop 1280 and phone 390 (touch), and at every
// page/state runs: axe-core (serious/critical fail, colour contrast ON), horizontal overflow, tap/click target size
// (phone >= 44 px, desktop >= 24 px), clean console (no errors/warnings), an origin allowlist (own origin, data:, blob:),
// layout shift. Phone also sweeps the routes at 320 px. Saves screenshots and prints their paths.
// Usage: CHROME_PATH=/path/to/chrome npm run admin-check [-- --out dir] [--no-build] [--break button,origin,axe]
//   --out dir     screenshots (default .tmp/admin-check/shots)
//   --no-build    reuse .tmp/admin-check/site from an earlier run
//   --break x     deliberately break the page so the run must FAIL (exit 1): button (30 px button), origin (fetch to
//                 another origin), axe (image without alt). Comma separated.
// Exit 0 pass, 1 fail, 2 skipped (no Chrome).
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { findChrome } from './design-check.mjs';
import { SKIPPED_MESSAGE } from './design-check-lib.mjs';
import { AXE_TAGS, clsOf, collectTargetsInPage, judgeCheckpoint, judgeCls, judgeConsole, judgeOrigins, judgeOverflow } from './admin-check-lib.mjs';
import { createDistServer, listen, resolveFile } from './serve-dist.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const work = join(root, '.tmp', 'admin-check');
const site = join(work, 'site');
const outDir = resolve(opt('--out', join(work, 'shots')));
const breaks = new Set((opt('--break', '') || '').split(',').filter(Boolean));
const skipBuild = args.includes('--no-build');

const chrome = findChrome();
if (!chrome) {
  console.log(SKIPPED_MESSAGE);
  process.exit(2);
}

const { default: puppeteer } = await import('puppeteer-core');
const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const WORLD = 'MP_ADMIN_FAKE_WORLD_7f3a9c'; // adapters/fake/marker.ts
const ADMIN_EMAIL = 'fotograf@example.test'; // the fake Google chooser signs this account in by default
const GOOGLE_BUTTON = /^Přihlásit se přes Google$/;
const DENIED_TEXT = /Tento účet Google nemá přístup do správy\. Zkuste se přihlásit jiným účtem Google\./;

// ---------------------------------------------------------------------------------------------- build and fixtures
if (!skipBuild) {
  const { build } = await import('vite');
  rmSync(site, { recursive: true, force: true });
  process.env.VITE_BACKEND = 'fake';
  console.log('building apps/admin with VITE_BACKEND=fake into .tmp/admin-check/site ...');
  await build({
    root: join(root, 'apps', 'admin'),
    configFile: join(root, 'apps', 'admin', 'vite.config.ts'),
    logLevel: 'warn',
    mode: 'production',
    build: { outDir: site, emptyOutDir: true },
  });
}
if (!existsSync(join(site, 'index.html'))) {
  console.error('no build in .tmp/admin-check/site (run without --no-build first)');
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
mkdirSync(join(work, 'fixtures'), { recursive: true });

/** Five generated photos with different shapes and colours; named so natural sort keeps this order. */
async function makeFixtures() {
  const specs = [
    ['foto-1.jpg', 1600, 1067, '#2f6fa8', '#d9a066'],
    ['foto-2.jpg', 1000, 1500, '#6a4c93', '#f2a65a'],
    ['foto-3.jpg', 1600, 1067, '#2a7f62', '#f6e8b1'],
    ['foto-4.jpg', 1200, 1200, '#b23a48', '#fcb9b2'],
    ['foto-5.jpg', 1600, 1067, '#3d405b', '#e07a5f'],
  ];
  const files = [];
  for (const [name, w, h, a, b] of specs) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/><circle cx="${w * 0.6}" cy="${h * 0.45}" r="${Math.min(w, h) * 0.2}" fill="#f2e6c8"/><rect y="${h * 0.8}" width="${w}" height="${h * 0.2}" fill="#33472f"/></svg>`;
    const file = join(work, 'fixtures', name);
    writeFileSync(file, await sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer());
    files.push(file);
  }
  return files;
}
const fixtureFiles = await makeFixtures();
const placeholderWebp = await sharp({ create: { width: 480, height: 320, channels: 3, background: '#8aa4b8' } }).webp().toBuffer();
const placeholderJpeg = await sharp({ create: { width: 1600, height: 1067, channels: 3, background: '#8aa4b8' } }).jpeg().toBuffer();

// ---------------------------------------------------------------------------------------------- server
// Static server of the build with SPA fallback; photo files of the public image host (there is none in the fake world)
// are answered with a plain placeholder from the same origin.
const distServer = createDistServer(site);
const serveDist = distServer.listeners('request')[0];
distServer.removeAllListeners('request');
distServer.on('request', (req, res) => {
  const path = new URL(req.url ?? '/', 'http://x').pathname;
  if (resolveFile(resolve(site), path)) return serveDist(req, res);
  if (/\.(webp|jpe?g)$/i.test(path)) {
    const webp = /\.webp$/i.test(path);
    res.writeHead(200, { 'content-type': webp ? 'image/webp' : 'image/jpeg', 'cache-control': 'no-store' });
    return res.end(webp ? placeholderWebp : placeholderJpeg);
  }
  if (/\.[a-z0-9]{2,5}$/i.test(path)) return serveDist(req, res); // a missing asset stays a 404
  req.url = '/index.html';
  return serveDist(req, res);
});
const { server, origin } = await listen(distServer);

// ---------------------------------------------------------------------------------------------- helpers
const failures = [];
const rows = [];
const shots = [];
const timings = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slug = (s) => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();

const PROFILES = [
  { name: 'desktop', width: 1280, height: 900, phone: false },
  { name: 'phone', width: 390, height: 844, phone: true },
];

/** First visible, enabled element of `selector` whose accessible label or text matches `re` (inside the open modal if any). */
async function find(page, selector, re, timeout = 10000) {
  try {
    const handle = await page.waitForFunction(
      (selector, source) => {
        const rx = new RegExp(source);
        const scope = document.querySelector('dialog:modal') ?? document;
        const clean = (s) => (s ?? '').trim().replace(/\s+/g, ' ');
        const hit = [...scope.querySelectorAll(selector)].find(
          (e) => e.getClientRects().length > 0 && !e.disabled && e.getAttribute('aria-disabled') !== 'true' && (rx.test(clean(e.getAttribute('aria-label'))) || rx.test(clean(e.textContent))),
        );
        return hit ?? false;
      },
      { timeout },
      selector,
      re.source,
    );
    return handle.asElement();
  } catch {
    const seen = await page.evaluate((selector) => [...document.querySelectorAll(selector)].filter((e) => e.getClientRects().length > 0).slice(0, 25).map((e) => (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 30)), selector);
    throw new Error(`no ${selector} matching ${re} (visible: ${seen.join(' | ')})`);
  }
}

async function fieldByLabel(page, re, timeout = 10000) {
  const handle = await page.waitForFunction(
    (source) => {
      const rx = new RegExp(source);
      const scope = document.querySelector('dialog:modal') ?? document;
      const label = [...scope.querySelectorAll('label')].find((l) => l.getClientRects().length > 0 && rx.test((l.textContent ?? '').trim().replace(/\s+/g, ' ')));
      return label?.htmlFor ? document.getElementById(label.htmlFor) : false;
    },
    { timeout },
    re.source,
  );
  return handle.asElement();
}

/** The sign-in is Google only: no password field and no password label anywhere on the page. */
async function expectNoPasswordUi(page) {
  const found = await page.evaluate(() => {
    if (document.querySelector('input[type=password], input[autocomplete$=password]')) return 'a password input';
    const label = [...document.querySelectorAll('label')].find((l) => /heslo/i.test(l.textContent ?? ''));
    return label ? `a label "${label.textContent.trim()}"` : null;
  });
  if (found) throw new Error(`the sign-in shows ${found}`);
}

async function waitText(page, re, timeout = 15000) {
  await page.waitForFunction((source) => new RegExp(source).test(document.body.innerText), { timeout }, re.source);
}

async function waitTiles(page, n, timeout = 30000) {
  await page.waitForFunction((n) => document.querySelectorAll('.photo-tile').length === n, { timeout }, n);
}

async function imagesLoaded(page) {
  await page.waitForFunction(() => [...document.images].every((i) => i.complete), { timeout: 10000 }).catch(() => {});
}

async function press(ctx, handle) {
  // Like a person scrolling: bring the control to the middle of the screen, clear of the fixed bars.
  await handle.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'nearest' }));
  if (ctx.profile.phone) await handle.tap();
  else await handle.click();
}

async function clickBy(ctx, selector, re) {
  await press(ctx, await find(ctx.page, selector, re));
}

async function typeInto(ctx, handle, text) {
  await handle.evaluate((el) => {
    el.focus();
    if (typeof el.select === 'function') el.select();
  });
  await ctx.page.keyboard.type(text);
}

async function spaGo(page, path) {
  await page.evaluate((p) => {
    history.pushState({}, '', p);
    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
  }, path);
  await sleep(200);
}

const world = (page, fn, ...a) => page.evaluate((key, fn, ...a) => new Function('w', `return (${fn})(w)`)(window[key]), WORLD, fn, ...a);

/** Measures and judges the current page state; screenshots when asked. */
async function checkpoint(ctx, name, { shot = true, targets = true, width = ctx.profile.width } = {}) {
  const { page, profile } = ctx;
  const label = `${profile.name} ${name}`;
  await imagesLoaded(page);
  await sleep(250); // let transitions and live regions settle
  if (ctx.firstCheckpoint) {
    ctx.firstCheckpoint = false;
    await injectBreaks(ctx);
  }
  if (!(await page.evaluate(() => typeof window.axe === 'object'))) await page.evaluate(axeSource);
  const m = await page.evaluate(
    async (tags) => {
      const result = await window.axe.run(document, { runOnly: { type: 'tag', values: tags } });
      return {
        axe: result.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          nodes: v.nodes.length,
          target: v.nodes[0]?.target?.join(' '),
          summary: v.nodes[0]?.any?.[0]?.message ?? v.nodes[0]?.none?.[0]?.message ?? v.help,
        })),
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      };
    },
    AXE_TAGS,
  );
  m.targets = targets ? await page.evaluate(collectTargetsInPage) : [];
  const bad = judgeCheckpoint(m, { phone: profile.phone });
  for (const b of bad) failures.push(`${label}: ${b}`);
  for (const v of m.axe.filter((v) => v.impact !== 'serious' && v.impact !== 'critical')) console.log(`  note ${label}: axe ${v.impact} ${v.id} (${v.nodes}) ${v.target ?? ''}`);
  const smallest = m.targets.length ? Math.min(...m.targets.map((t) => Math.min(t.w, t.h))) : null;
  rows.push({ label, width, axe: m.axe.filter((v) => v.impact === 'serious' || v.impact === 'critical').length, axeAll: m.axe.length, overflow: Math.max(0, m.scrollWidth - m.innerWidth), targets: m.targets.length, smallest: smallest === null ? '-' : Math.round(smallest), result: bad.length ? 'FAIL' : 'ok' });
  if (shot) {
    const file = join(outDir, `${profile.name}-${slug(name)}.png`);
    await page.screenshot({ path: file, fullPage: true });
    shots.push(file);
  }
}

async function injectBreaks(ctx) {
  const { page } = ctx;
  if (breaks.has('button')) {
    await page.evaluate(() => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = 'x';
      b.setAttribute('aria-label', 'Deliberately small');
      b.style.cssText = 'display:block;width:30px;height:30px';
      document.body.append(b);
    });
  }
  if (breaks.has('axe')) {
    await page.evaluate(() => {
      const i = document.createElement('img');
      i.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=';
      document.body.append(i);
    });
  }
  if (breaks.has('origin')) {
    await page.evaluate(() => {
      fetch('http://127.0.0.1:9/admin-check-break').catch(() => undefined);
    });
    await sleep(300);
  }
}

// ---------------------------------------------------------------------------------------------- one profile
async function runProfile(browser, profile) {
  const page = await browser.newPage();
  await page.setViewport({ width: profile.width, height: profile.height, deviceScaleFactor: profile.phone ? 2 : 1, hasTouch: profile.phone, isMobile: profile.phone });
  const ctx = { page, profile, firstCheckpoint: true };
  const requests = [];
  const messages = [];
  page.on('request', (r) => requests.push(r.url()));
  page.on('console', (m) => messages.push({ type: m.type(), text: m.text() }));
  page.on('pageerror', (e) => messages.push({ type: 'pageerror', text: e.message }));
  page.on('requestfailed', (r) => {
    if (!breaks.has('origin') || !r.url().includes(':9/')) messages.push({ type: 'error', text: `request failed: ${r.url()} ${r.failure()?.errorText ?? ''}` });
  });
  page.on('response', (r) => {
    if (r.status() >= 400) messages.push({ type: 'error', text: `HTTP ${r.status()} ${r.url()}` });
  });
  await page.evaluateOnNewDocument(() => {
    window.__ls = [];
    window.__lcp = 0;
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) if (!e.hadRecentInput) window.__ls.push({ value: e.value, startTime: e.startTime });
      }).observe({ type: 'layout-shift', buffered: true });
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) window.__lcp = e.startTime;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch {
      /* not supported: the check then reports 0 */
    }
  });

  const urls = {};
  let stepName = 'start';
  const step = async (name, fn) => {
    stepName = name;
    const t0 = Date.now();
    await fn();
    timings.push({ label: `${profile.name} ${name}`, ms: Date.now() - t0 });
  };

  try {
    // ---- login (F0): the Google card; offline, cancel, outsider (fake chooser), then the photographer
    await step('open the app', async () => {
      await page.goto(`${origin}/`, { waitUntil: 'networkidle0' });
      await find(page, '.login-card button', GOOGLE_BUTTON);
      await expectNoPasswordUi(page);
      const nav = await page.evaluate(() => {
        const n = performance.getEntriesByType('navigation')[0];
        const fcp = performance.getEntriesByName('first-contentful-paint')[0];
        return { dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), fcp: Math.round(fcp?.startTime ?? 0), lcp: Math.round(window.__lcp) };
      });
      timings.push({ label: `${profile.name} page load: FCP ${nav.fcp} ms, LCP ${nav.lcp} ms, DOMContentLoaded ${nav.dcl} ms, load ${nav.load} ms`, ms: nav.load });
      await checkpoint(ctx, 'login');
    });
    await step('login with injected failures', async () => {
      // Offline: the fake chooser cannot be reached.
      await world(page, '(w) => w.failNext("auth.signInWithGoogle", "network")');
      await clickBy(ctx, '.login-card button', GOOGLE_BUTTON);
      await waitText(page, /Chybí připojení k internetu\./);
      await checkpoint(ctx, 'login offline error');
      // Cancelled at Google.
      await world(page, '(w) => { w.google.next = "cancel"; }');
      await clickBy(ctx, '.login-card button', GOOGLE_BUTTON);
      await waitText(page, /Přihlášení přes Google bylo zrušeno\./);
      await checkpoint(ctx, 'login cancelled');
      // A Google account that is not on the list.
      await world(page, '(w) => { w.google.next = "outsider"; }');
      await clickBy(ctx, '.login-card button', GOOGLE_BUTTON);
      await waitText(page, DENIED_TEXT);
      const signedIn = await world(page, '(w) => w.snapshot().signedInAs');
      if (signedIn !== null) throw new Error(`the outsider stayed signed in as ${signedIn}`);
      await expectNoPasswordUi(page);
      await checkpoint(ctx, 'login not an admin');
      // The photographer.
      await clickBy(ctx, '.login-card button', GOOGLE_BUTTON);
      await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Kategorie', { timeout: 15000 });
    });

    // ---- F4a: a category
    await step('categories', async () => {
      await waitText(page, /\d+ (album|alba|alb)/);
      await checkpoint(ctx, 'categories');
      await clickBy(ctx, 'button', /^Nová kategorie$/);
      await fieldByLabel(page, /^Název/);
      await checkpoint(ctx, 'category dialog', { shot: true });
      await typeInto(ctx, await fieldByLabel(page, /^Název/), 'Kontrolní svatby');
      await clickBy(ctx, 'button', /^Vytvořit$/);
      await find(page, 'a', /^Kontrolní svatby$/);
      await clickBy(ctx, 'a', /^Kontrolní svatby$/);
      await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Kontrolní svatby', { timeout: 10000 });
      urls.category = new URL(page.url()).pathname;
      await checkpoint(ctx, 'category empty');
    });

    // ---- F1: album and 5 photos
    await step('create album', async () => {
      await clickBy(ctx, 'button', /^Nové album$/);
      await typeInto(ctx, await fieldByLabel(page, /^Název/), 'Novákovi');
      await typeInto(ctx, await fieldByLabel(page, /^Místo/), 'Brno');
      await checkpoint(ctx, 'album dialog', { shot: false });
      await clickBy(ctx, 'button', /^Vytvořit$/);
      await page.waitForFunction(() => location.pathname.startsWith('/alba/'), { timeout: 10000 });
      await waitText(page, /Přetáhněte sem fotky/);
      urls.album = new URL(page.url()).pathname;
      await checkpoint(ctx, 'album empty');
    });
    await step('upload 5 photos (one PUT fails once)', async () => {
      await world(page, '(w) => w.failNext("upload.put", "network", 1)');
      const input = await page.$('input[type=file]');
      await input.uploadFile(...fixtureFiles);
      await page.waitForFunction(() => /Fronta nahrávání/.test(document.body.innerText) || document.querySelectorAll('.photo-tile').length > 0, { timeout: 15000 });
      await checkpoint(ctx, 'upload drawer', { shot: true });
      await waitText(page, /Nahráno 5 fotek\./, 60000);
      await waitTiles(page, 5);
      await checkpoint(ctx, 'upload done', { shot: false });
      await clickBy(ctx, 'button', /^Sbalit frontu$/); // the drawer stays open until the photographer collapses it
    });
    await step('album grid', async () => {
      await sleep(400);
      await checkpoint(ctx, 'album grid');
    });

    // ---- photo detail: alt text and caption
    const tileIds = () => page.evaluate(() => [...document.querySelectorAll('.photo-tile')].map((t) => t.dataset.photoId));
    const ids0 = await tileIds();
    await step('tile menu and photo detail', async () => {
      await clickBy(ctx, 'button', /^Akce s fotkou 1$/);
      await find(page, 'a', /^Upravit popisek$/); // the sheet is open (photo 1 is the cover, so no "Nastavit jako titulní")
      await checkpoint(ctx, 'tile menu');
      await clickBy(ctx, 'a', /^Upravit popisek$/);
      await page.waitForFunction(() => /\/foto\//.test(location.pathname), { timeout: 10000 });
      urls.photo = new URL(page.url()).pathname;
      await fieldByLabel(page, /^Alternativní text/);
      await checkpoint(ctx, 'photo detail');
      await typeInto(ctx, await fieldByLabel(page, /^Alternativní text/), 'Nevěsta s kyticí před kostelem');
      await typeInto(ctx, await fieldByLabel(page, /^Popisek/), 'Před obřadem');
      await clickBy(ctx, 'button', /^Uložit$/);
      await waitText(page, /Uloženo/);
      const saved = await world(page, '(w) => w.snapshot().photos.filter((p) => p.alt === "Nevěsta s kyticí před kostelem" && p.caption === "Před obřadem").length');
      if (saved !== 1) throw new Error(`alt text and caption were not saved (${saved} photos carry them)`);
      await checkpoint(ctx, 'photo detail saved', { shot: false });
      await clickBy(ctx, 'a, button', /Zpět na album/);
      await waitTiles(page, 5);
    });

    // ---- F3 cover, F2 reorder, F5 delete
    await step('cover, reorder, delete', async () => {
      await clickBy(ctx, 'button', /^Akce s fotkou 2$/);
      await clickBy(ctx, 'button', /^Nastavit jako titulní$/);
      await waitText(page, /Titulní fotka nastavena\./);
      // T-243: reordering is drag only. Lift photo 3 on its handle with the keyboard sensor (Space), move it to
      // the first place with the arrow keys (Left, Up, which one applies depends on the columns), drop with Space.
      const dragHandle = await find(page, 'button', /^Přetáhnout fotku 3$/);
      await dragHandle.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'nearest' }));
      await dragHandle.focus();
      await page.keyboard.press('Space');
      await waitText(page, /zvednuto\. Pozice 3 z/);
      for (const key of ['ArrowLeft', 'ArrowUp', 'ArrowLeft', 'ArrowUp', 'ArrowLeft', 'ArrowUp']) {
        const atStart = await page.evaluate(() => /je nad pozicí 1 z/.test(document.body.innerText));
        if (atStart) break;
        await page.keyboard.press(key);
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      await waitText(page, /je nad pozicí 1 z/);
      await page.keyboard.press('Space');
      await page.waitForFunction((id) => document.querySelector('.photo-tile')?.dataset.photoId === id, { timeout: 10000 }, ids0[2]);
      await checkpoint(ctx, 'album grid after cover and reorder', { shot: false });
      await clickBy(ctx, 'button', /^Akce s fotkou 5$/);
      await clickBy(ctx, 'button', /^Smazat fotku$/);
      await waitText(page, /Smazat fotku\?/);
      await checkpoint(ctx, 'delete dialog');
      await clickBy(ctx, 'button', /^Smazat$/);
      await waitTiles(page, 4);
      await waitText(page, /Smazána 1 fotka\. Uvolněno/);
    });

    // ---- F4 hide, publish album
    await step('publish and hide album', async () => {
      await clickBy(ctx, 'button', /^Zveřejnit album$/);
      await find(page, 'button', /^Skrýt album$/);
      await clickBy(ctx, 'button', /^Skrýt album$/);
      await waitText(page, /Skrýt album Novákovi\?/);
      await checkpoint(ctx, 'hide dialog', { shot: false });
      await clickBy(ctx, 'button', /^Skrýt album$/);
      await find(page, 'button', /^Zveřejnit album$/);
      await clickBy(ctx, 'button', /^Zveřejnit album$/);
      await find(page, 'button', /^Skrýt album$/);
    });

    // ---- F6 publish the site, with one failure first
    await step('publish site', async () => {
      await clickBy(ctx, 'a', /^Zveřejnit/);
      await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Zveřejnit web', { timeout: 10000 });
      await waitText(page, /úprav/);
      await checkpoint(ctx, 'publish');
      await world(page, '(w) => { w.setBuildDelay(1500); w.failNext("api.publish", "network", 1); }');
      await clickBy(ctx, 'button', /^Zveřejnit web$/);
      await page.waitForSelector('.publish-card [role=alert]', { timeout: 10000 });
      await checkpoint(ctx, 'publish failed', { shot: true });
      await clickBy(ctx, 'button', /^Zveřejnit web$/);
      await waitText(page, /Web se aktualizuje|Zveřejňuji/);
      await checkpoint(ctx, 'publish building', { shot: false });
      await waitText(page, /Web je aktualizovaný\./, 30000);
      await checkpoint(ctx, 'publish done');
    });

    // ---- storage screen and reconcile
    await step('storage', async () => {
      const link = await page.evaluateHandle(() => [...document.querySelectorAll('a[href="/ulozeni"]')].find((a) => a.getClientRects().length > 0) ?? null);
      if (link.asElement()) await press(ctx, link.asElement());
      else await spaGo(page, '/ulozeni');
      await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Úložiště', { timeout: 10000 });
      await waitText(page, /Využití podle alb/);
      urls.storage = '/ulozeni';
      await checkpoint(ctx, 'storage');
      await clickBy(ctx, 'button', /^Zkontrolovat úložiště$/);
      await waitText(page, /Součet souhlasí\.|Nalezené rozdíly|Rozdíl/, 30000);
      await checkpoint(ctx, 'storage reconcile');
    });
    await step('upload page', async () => {
      await clickBy(ctx, 'a', /^Nahrávání$/);
      await page.waitForFunction(() => location.pathname === '/nahravani', { timeout: 10000 });
      await checkpoint(ctx, 'upload page', { shot: false });
    });

    // ---- expired session: a modal over the running app (Escape ignored, Google button, honest copy)
    await step('expired session', async () => {
      await world(page, '(w) => w.expireSession()');
      await page.waitForFunction(() => document.querySelector('dialog:modal') !== null, { timeout: 10000 });
      await waitText(page, /Přihlášení vypršelo/);
      await waitText(page, /Po přihlášení se stránka načte znovu, neuložené změny a fotky ve frontě se ztratí\./);
      await find(page, 'button', GOOGLE_BUTTON);
      await expectNoPasswordUi(page);
      await checkpoint(ctx, 'expired session dialog');
      await page.keyboard.press('Escape');
      await sleep(300);
      if (!(await page.evaluate(() => document.querySelector('dialog:modal') !== null))) throw new Error('Escape closed the expired-session dialog');
      await clickBy(ctx, 'button', GOOGLE_BUTTON);
      await page.waitForFunction(() => document.querySelector('dialog:modal') === null, { timeout: 15000 });
      const again = await world(page, '(w) => w.snapshot().signedInAs');
      if (again !== ADMIN_EMAIL) throw new Error(`after the re-sign-in the session is ${again}`);
    });

    // ---- phone: 320 px reflow sweep over every route (client-side navigation keeps the fake session)
    if (profile.phone) {
      await step('320 px sweep', async () => {
        await page.setViewport({ width: 320, height: 700, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
        for (const [name, path] of [['categories', '/'], ['category', urls.category], ['album', urls.album], ['photo', urls.photo], ['publish', '/zverejnit'], ['storage', '/ulozeni'], ['upload', '/nahravani']]) {
          await spaGo(page, path);
          await sleep(500);
          await checkpoint(ctx, `${name} at 320`, { shot: name === 'album', targets: false, width: 320 });
        }
      });
    }

    await step('sign out', async () => {
      await page.setViewport({ width: profile.width, height: profile.height, deviceScaleFactor: profile.phone ? 2 : 1, hasTouch: profile.phone, isMobile: profile.phone });
      await spaGo(page, '/');
      await clickBy(ctx, 'button', /^Odhlásit se$/);
      await find(page, '.login-card button', GOOGLE_BUTTON);
    });

    // ---- layout shift and timing
    const cls = clsOf(await page.evaluate(() => window.__ls));
    failures.push(...judgeCls(cls).map((f) => `${profile.name}: ${f}`));
    timings.push({ label: `${profile.name} worst layout shift window ${cls.toFixed(3)}`, ms: 0 });
  } catch (e) {
    failures.push(`${profile.name}: flow stopped at "${stepName}": ${e.message}`);
    const file = join(outDir, `${profile.name}-FAILED-${slug(stepName)}.png`);
    await page.screenshot({ path: file, fullPage: true }).catch(() => undefined);
    shots.push(file);
  }

  failures.push(...judgeOrigins(requests, origin).map((f) => `${profile.name}: ${f}`));
  failures.push(...judgeConsole(messages).map((f) => `${profile.name}: ${f}`));
  console.log(`${profile.name}: ${requests.length} requests, ${messages.length} console messages`);
  await page.close();
}

// ---------------------------------------------------------------------------------------------- main
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
try {
  for (const profile of PROFILES) await runProfile(browser, profile);
} catch (e) {
  failures.push(`error: ${e.message}`);
  console.error(e);
} finally {
  await browser.close();
  server.close();
}

const cols = [['page / state', 'label'], ['width', 'width'], ['axe s/c', 'axe'], ['axe all', 'axeAll'], ['overflow px', 'overflow'], ['targets', 'targets'], ['smallest px', 'smallest'], ['result', 'result']];
const cell = (r, c) => String(r[c[1]] ?? '');
const pad = (rowsAll) => cols.map((c, i) => Math.max(...rowsAll.map((r) => (r === 'head' ? c[0] : cell(r, c)).length)));
const widths = pad(['head', ...rows]);
const fmt = (vals) => vals.map((v, i) => String(v).padEnd(widths[i])).join('  ');
console.log(fmt(cols.map((c) => c[0])));
for (const r of rows) console.log(fmt(cols.map((c) => cell(r, c))));
console.log('timing:');
for (const t of timings) console.log(`  ${t.label}${t.ms && !/page load|layout shift/.test(t.label) ? `: ${t.ms} ms` : ''}`);
console.log('screenshots:');
for (const s of shots) console.log(`  ${s}`);
console.log(failures.length ? `ADMIN_CHECK: FAIL\n${failures.map((f) => `- ${f}`).join('\n')}` : 'ADMIN_CHECK: PASS');
process.exit(failures.length ? 1 : 0);
