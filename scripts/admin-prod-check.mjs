// admin-prod-check (WP5-29): the PRODUCTION build of apps/admin (real adapters, VITE_BACKEND unset) with the generated
// `_headers`, served by the static server of scripts/serve-dist.mjs, against mocked Supabase / Worker / image host /
// public site / R2 on localhost ports. A real Chrome signs in, opens the publish and storage screens and the check
// fails on any securitypolicyviolation, console error/warning or request outside the five mock origins. Then it
// proves that the CSP is enforced: an allowed origin per directive works, a foreign origin / inline script / foreign
// image are reported as violations. Prints the bundle report (raw and gzip per file, initial JS and CSS).
// Usage: npm run admin-prod-check [-- --no-build]   (finds Chrome itself, see findChrome in design-check.mjs)
// Exit 0 pass, 1 fail, 2 skipped (no Chrome).
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { findChrome } from './design-check.mjs';
import { SKIPPED_MESSAGE } from './design-check-lib.mjs';
import { judgeConsole, judgeOrigins } from './admin-check-lib.mjs';
import { gzipSize, initialAssets, judgeBundle, judgeCsp, judgeDocumentHeaders } from './admin-prod-check-lib.mjs';
import { createDistServer, listen } from './serve-dist.mjs';

const args = process.argv.slice(2);
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const site = join(root, '.tmp', 'admin-prod', 'site');
const skipBuild = args.includes('--no-build');

const chrome = findChrome();
if (!chrome) {
  console.log(SKIPPED_MESSAGE);
  process.exit(2);
}
const { default: puppeteer } = await import('puppeteer-core');

// ---------------------------------------------------------------------------------------------- mock origins
const ADMIN = { id: '3b1f6c1e-6d1c-4b43-9a6e-2f0d8f7a1c11', email: 'fotograf@example.test', password: 'mock-heslo-1' };
const NOW = new Date().toISOString();
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = () => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: ADMIN.id, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.mock`;
const placeholder = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#8aa4b8' } }).webp().toBuffer();

const ROWS = {
  admins: [{ user_id: ADMIN.id, created_at: NOW }],
  categories: [{ id: '11111111-1111-4111-8111-111111111111', slug: 'svatby', name: 'Svatby', description: null, seo_title: null, seo_description: null, sort: 1, visible: true, created_at: NOW, updated_at: NOW }],
  albums: [],
  photos: [],
  app_config: [{ id: true, quota_hard_bytes: 10_000_000_000, quota_warn_bytes: 8_000_000_000, max_upload_bytes: 12_000_000, max_files_per_batch: 100, reservation_ttl_min: 30 }],
  site_state: [{ id: true, pending_changes: 2, last_published_at: NOW, last_publish_requested_at: null }],
  publish_log: [],
};
const hits = { supabase: 0, api: 0, img: 0, site: 0, r2: 0 };

function mock(kind) {
  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const cors = {
      'access-control-allow-origin': req.headers.origin ?? '*',
      'access-control-allow-headers': req.headers['access-control-request-headers'] ?? '*',
      'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      vary: 'Origin',
    };
    if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
    hits[kind] += 1;
    const json = (status, body) => res.writeHead(status, { ...cors, 'content-type': 'application/json' }).end(JSON.stringify(body));
    req.resume();
    if (kind === 'supabase') {
      if (url.pathname === '/auth/v1/token') {
        return json(200, { access_token: jwt(), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'mock-refresh', user: { id: ADMIN.id, aud: 'authenticated', role: 'authenticated', email: ADMIN.email, app_metadata: {}, user_metadata: {}, created_at: NOW } });
      }
      if (url.pathname === '/auth/v1/logout') return res.writeHead(204, cors).end();
      const table = url.pathname.replace('/rest/v1/', '');
      if (url.pathname.startsWith('/rest/v1/') && table in ROWS) return json(200, ROWS[table]);
      return json(404, { message: 'mock: unknown' });
    }
    if (kind === 'api') {
      if (url.pathname === '/storage') return json(200, { used_bytes: 1_200_000_000, reserved_bytes: 0, hard: 10_000_000_000, warn: 8_000_000_000, photo_count: 120, level: 'ok' });
      return json(404, { error: 'NOT_FOUND' });
    }
    if (kind === 'site') {
      if (url.pathname === '/_publish.json') return json(200, { snapshotGeneratedAt: NOW, builtAt: NOW, counts: { categories: 1, albums: 0, photos: 0 } });
      return json(404, {});
    }
    if (kind === 'img') return res.writeHead(200, { ...cors, 'content-type': 'image/webp', 'cross-origin-resource-policy': 'cross-origin' }).end(placeholder);
    return res.writeHead(200, cors).end(); // r2: accepts the PUT
  });
}
const mocks = {};
for (const kind of ['supabase', 'api', 'img', 'site', 'r2']) mocks[kind] = await listen(mock(kind));
const mockOrigins = Object.values(mocks).map((m) => m.origin);

// ---------------------------------------------------------------------------------------------- build
const ENV = {
  VITE_SUPABASE_URL: mocks.supabase.origin,
  VITE_SUPABASE_ANON_KEY: 'mock-anon-key',
  VITE_API_BASE_URL: mocks.api.origin,
  VITE_IMG_BASE_URL: mocks.img.origin,
  VITE_PUBLIC_SITE_URL: mocks.site.origin,
  VITE_R2_UPLOAD_ORIGIN: mocks.r2.origin,
};
if (!skipBuild) {
  const { build } = await import('vite');
  rmSync(site, { recursive: true, force: true });
  delete process.env.VITE_BACKEND; // real adapters
  Object.assign(process.env, ENV);
  console.log('building apps/admin (production, real adapters) into .tmp/admin-prod/site ...');
  await build({ root: join(root, 'apps', 'admin'), configFile: join(root, 'apps', 'admin', 'vite.config.ts'), logLevel: 'warn', mode: 'production', build: { outDir: site, emptyOutDir: true } });
}
if (!existsSync(join(site, 'index.html'))) {
  console.error('no build in .tmp/admin-prod/site (run without --no-build first)');
  process.exit(1);
}
const failures = [];

// ---------------------------------------------------------------------------------------------- bundle report
const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)).map((f) => `${n}/${f}`) : [n]));
const html = readFileSync(join(site, 'index.html'), 'utf8');
const initial = initialAssets(html);
const initialSet = new Set([...initial.js, ...initial.css].map((p) => p.replace(/^\//, '')));
const rows = walk(site)
  .filter((f) => /\.(js|css)$/.test(f))
  .map((file) => {
    const buf = readFileSync(join(site, file));
    return { file, raw: buf.length, gzip: gzipSize(buf), initial: initialSet.has(file) };
  })
  .sort((a, b) => b.gzip - a.gzip);
const bundle = judgeBundle(rows);
failures.push(...bundle.failures);
const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
console.log('bundle report (gzip is what the host sends):');
for (const r of rows) console.log(`  ${r.initial ? 'initial' : 'lazy   '}  ${r.file.padEnd(34)} raw ${kb(r.raw).padStart(9)}  gzip ${kb(r.gzip).padStart(8)}`);
console.log(`  entry chunk ${kb(bundle.totals.initialJsRaw)} raw / ${kb(bundle.totals.initialJsGzip)} gzip; all JS fetched at start-up (entry + real adapters) ${kb(bundle.totals.jsRaw)} raw / ${kb(bundle.totals.jsGzip)} gzip (limit 300 kB gzip); initial CSS ${kb(bundle.totals.cssRaw)} raw / ${kb(bundle.totals.cssGzip)} gzip`);

// ---------------------------------------------------------------------------------------------- browser
const distServer = createDistServer(site);
const serveDist = distServer.listeners('request')[0];
distServer.removeAllListeners('request');
distServer.on('request', (req, res) => {
  // SPA fallback like the _redirects of Pages: unknown extension-less paths answer index.html.
  const path = new URL(req.url ?? '/', 'http://x').pathname;
  if (!/\.[a-z0-9]{2,5}$/i.test(path)) req.url = '/index.html';
  return serveDist(req, res);
});
const { server, origin } = await listen(distServer);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const requests = [];
const messages = [];
let documentHeaders = {};
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  page.on('request', (r) => requests.push(r.url()));
  page.on('console', (m) => messages.push({ type: m.type(), text: m.text() }));
  page.on('pageerror', (e) => messages.push({ type: 'pageerror', text: e.message }));
  page.on('requestfailed', (r) => messages.push({ type: 'error', text: `request failed: ${r.url()} ${r.failure()?.errorText ?? ''}` }));
  page.on('response', (r) => {
    if (r.status() >= 400 && !r.url().startsWith(mocks.site.origin) && !r.url().startsWith(mocks.api.origin)) messages.push({ type: 'error', text: `HTTP ${r.status()} ${r.url()}` });
  });
  await page.evaluateOnNewDocument(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push({ directive: e.effectiveDirective, blocked: e.blockedURI, probe: window.__probing === true }));
  });

  const field = async (re) =>
    (await page.waitForFunction((src) => {
      const l = [...document.querySelectorAll('label')].find((x) => new RegExp(src).test((x.textContent ?? '').trim()) && x.getClientRects().length > 0);
      return l?.htmlFor ? document.getElementById(l.htmlFor) : false;
    }, { timeout: 15000 }, re.source)).asElement();
  const type = async (el, text) => {
    await el.focus();
    await page.keyboard.type(text);
  };
  const h1 = (text) => page.waitForFunction((t) => document.querySelector('h1')?.textContent === t, { timeout: 15000 }, text);
  const spaGo = async (path) => {
    await page.evaluate((p) => {
      history.pushState({}, '', p);
      window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
    }, path);
  };

  const response = await page.goto(`${origin}/`, { waitUntil: 'networkidle0' });
  documentHeaders = response.headers();
  failures.push(...judgeDocumentHeaders(documentHeaders));

  await page.waitForSelector('form', { timeout: 15000 });
  await type(await field(/^E-mail/), ADMIN.email);
  await type(await field(/^Heslo$/), ADMIN.password);
  await (await page.waitForFunction(() => [...document.querySelectorAll('button')].find((b) => /^Přihlásit se$/.test(b.textContent.trim())) ?? false)).asElement().click();
  await h1('Kategorie');
  await page.waitForFunction(() => /Svatby/.test(document.body.innerText), { timeout: 15000 });
  await spaGo('/zverejnit');
  await h1('Zveřejnit web');
  await page.waitForFunction(() => /úprav/.test(document.body.innerText), { timeout: 15000 });
  await sleep(500); // publish status read from the public site
  await spaGo('/ulozeni');
  await h1('Úložiště');
  await page.waitForFunction(() => /Využití podle alb|Úložiště/.test(document.body.innerText), { timeout: 15000 });
  await sleep(500);
  console.log(`app flow done: sign in, categories, publish, storage. mock hits ${JSON.stringify(hits)}`);
  if (hits.supabase === 0 || hits.api === 0) failures.push(`the real adapters did not reach every mock (hits ${JSON.stringify(hits)})`);

  const appViolations = await page.evaluate(() => window.__csp.filter((v) => !v.probe));

  // ---- probes: the policy is enforced (so "no violations" above means something) and the env origins work.
  const probes = await page.evaluate(
    async (o) => {
      window.__probing = true;
      const attempt = (fn) => fn().then(() => true, () => false);
      const xhrPut = (url) => new Promise((ok, fail) => { const x = new XMLHttpRequest(); x.open('PUT', url); x.onload = () => ok(); x.onerror = () => fail(); x.send(new Blob(['x'])); });
      const img = (url) => new Promise((ok, fail) => { const i = new Image(); i.onload = ok; i.onerror = fail; i.src = url; });
      const allowed = [
        { name: 'fetch Supabase origin', ok: await attempt(() => fetch(`${o.supabase}/rest/v1/admins`)) },
        { name: 'fetch Worker API origin', ok: await attempt(() => fetch(`${o.api}/storage`)) },
        { name: 'fetch public site origin', ok: await attempt(() => fetch(`${o.site}/_publish.json`)) },
        { name: 'XHR PUT to R2 upload origin', ok: await attempt(() => xhrPut(`${o.r2}/photos/x`)) },
        { name: 'image from the image host', ok: await attempt(() => img(`${o.img}/p.webp`)) },
      ];
      await attempt(() => fetch('http://127.0.0.1:9/foreign'));
      await attempt(() => img('http://127.0.0.1:9/foreign.png'));
      const s = document.createElement('script');
      s.textContent = 'window.__inline = 1';
      document.head.append(s);
      await new Promise((r) => setTimeout(r, 300));
      return { allowed, inline: window.__inline === 1 };
    },
    Object.fromEntries(Object.entries(mocks).map(([k, v]) => [k, v.origin])),
  );
  const seen = await page.evaluate(() => window.__csp.filter((v) => v.probe));
  const saw = (directive, re) => seen.some((v) => v.directive === directive && re.test(v.blocked));
  const result = {
    allowed: probes.allowed,
    blocked: [
      { name: 'fetch to a foreign origin', directive: 'connect-src', seen: saw('connect-src', /127\.0\.0\.1:9/) },
      { name: 'image from a foreign origin', directive: 'img-src', seen: saw('img-src', /127\.0\.0\.1:9/) },
      { name: 'inline script', directive: 'script-src-elem', seen: saw('script-src-elem', /inline/) && !probes.inline },
    ],
  };
  failures.push(...judgeCsp(appViolations, result));
  console.log(`CSP: ${appViolations.length} violations while the app ran; probes allowed ${result.allowed.filter((p) => p.ok).length}/${result.allowed.length}, blocked ${result.blocked.filter((p) => p.seen).length}/${result.blocked.length}`);
  console.log(`CSP header: ${documentHeaders['content-security-policy']}`);
} catch (e) {
  failures.push(`flow stopped: ${e.message}`);
} finally {
  await browser.close();
  server.close();
  for (const m of Object.values(mocks)) m.server.close();
}

// Probe requests to 127.0.0.1:9 are expected to fail; everything else must stay within the page and mock origins.
const appRequests = requests.filter((u) => !mockOrigins.some((o) => u.startsWith(o)) && !u.includes('127.0.0.1:9/'));
failures.push(...judgeOrigins(appRequests, origin));
const probeNoise = /127\.0\.0\.1:9|Content Security Policy|Refused to (connect|load|execute)|ERR_BLOCKED_BY_CSP|ERR_CONNECTION_REFUSED|ERR_FAILED/;
failures.push(...judgeConsole(messages.filter((m) => !probeNoise.test(m.text))).map((f) => f));
console.log(`requests: ${requests.length}, console messages: ${messages.length}`);
for (const m of messages) console.log(`  [${probeNoise.test(m.text) ? 'expected: deliberate CSP probe' : 'JUDGED'}] ${m.type}: ${m.text.slice(0, 200)}`);
console.log(failures.length ? `ADMIN_PROD_CHECK: FAIL\n${failures.map((f) => `- ${f}`).join('\n')}` : `ADMIN_PROD_CHECK: PASS (JS ${kb(bundle.totals.jsGzip)} gzip, entry chunk ${kb(bundle.totals.initialJsGzip)})`);
process.exit(failures.length ? 1 : 0);
