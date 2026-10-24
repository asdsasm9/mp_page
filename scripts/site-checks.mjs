// Build-output checks of the public site (plan WP3-22, `page-checks`). Pure functions over a loaded `site`:
//   { pages: [{path, html}], sitemapXml, redirectsText, files: string[], siteEnv }
// `path` is relative to apps/web/dist (posix), `files` lists every file in dist (posix, relative), `siteEnv` is
// 'production' | 'preview' | 'local' (from dist/_publish.json). Each check returns a list of problem strings.
// `[doplnit]` markers are a warning, except in a production build where they are an error (human task H-7).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BUDGET, KB, aboveFoldImageUrls, checkWeight, measureFirstLoad } from '../apps/web/src/lib/weight.ts';

export const SITE_ORIGIN = 'https://www.mullnyphotos.cz';
export const PLACEHOLDER = '[doplnit]';

// ------------------------------------------------------------------ tiny HTML helpers

const decode = (s) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

/** Attributes of one start tag, lower-cased names; boolean attributes get "". */
export function attrsOf(tag) {
  const out = {};
  const re = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  const inner = tag.replace(/^<[^\s>/]+/, '').replace(/\/?>$/, '');
  for (const m of inner.matchAll(re)) {
    const name = m[1].toLowerCase();
    if (!(name in out)) out[name] = decode(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out;
}

const tagsOf = (html, name) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map((m) => m[0]);
const head = (html) => /<head\b[\s\S]*?<\/head>/i.exec(html)?.[0] ?? '';
const metas = (html) => tagsOf(head(html), 'meta').map(attrsOf);
const metaContent = (html, key, value) =>
  metas(html).filter((a) => (a[key] ?? '').toLowerCase() === value).map((a) => (a.content ?? '').trim());
const links = (html, rel) => tagsOf(head(html), 'link').map(attrsOf).filter((a) => (a.rel ?? '').toLowerCase() === rel);
const titles = (html) => [...head(html).matchAll(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/gi)].map((m) => decode(m[1]).trim());
const jsonLdBlocks = (html) =>
  [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
    .filter((m) => /type\s*=\s*["']?application\/ld\+json/i.test(m[1]))
    .map((m) => m[2]);

/** URL path of a built page: `a/b/index.html` -> `/a/b/`, `404.html` -> `/404/`. */
export function routeOf(path) {
  if (path === 'index.html') return '/';
  if (path.endsWith('/index.html')) return `/${path.slice(0, -'index.html'.length)}`;
  return `/${path.replace(/\.html$/, '')}/`;
}

export const is404 = (page) => page.path === '404.html';
const where = (page) => `/${page.path}`;

// ------------------------------------------------------------------ per page checks

export function checkHead(page) {
  const p = [];
  const html = page.html;
  const nf = is404(page);
  const t = titles(html);
  if (t.length !== 1) p.push(`${t.length} <title> elements, expected 1`);
  else if (t[0] === '') p.push('empty <title>');
  const desc = metaContent(html, 'name', 'description');
  if (!nf) {
    if (desc.length !== 1) p.push(`${desc.length} meta descriptions, expected 1`);
    else if (desc[0] === '') p.push('empty meta description');
  } else if (desc.length > 1) p.push(`${desc.length} meta descriptions`);
  const canon = links(html, 'canonical');
  if (canon.length !== 1) p.push(`${canon.length} canonical links, expected 1`);
  else {
    const href = canon[0].href ?? '';
    if (!href.startsWith(`${SITE_ORIGIN}/`)) p.push(`canonical "${href}" is not absolute on ${SITE_ORIGIN}`);
    else if (!href.endsWith('/')) p.push(`canonical "${href}" has no trailing slash`);
    else if (href !== `${SITE_ORIGIN}${routeOf(page.path)}`) {
      p.push(`canonical "${href}" does not match the page URL ${SITE_ORIGIN}${routeOf(page.path)}`);
    }
  }
  const h1 = [...html.matchAll(/<h1\b/gi)].length;
  if (h1 !== 1) p.push(`${h1} <h1> elements, expected 1`);
  const lang = /<html\b[^>]*>/i.exec(html)?.[0];
  if (!lang || (attrsOf(lang).lang ?? '').toLowerCase() !== 'cs') p.push('<html> has no lang="cs"');
  // The 404 page has no description and, like the cookies page, no share image (Base.astro renders a
  // `summary` card without one); every other page needs the full set.
  const need = nf
    ? [
        ['property', 'og:title'],
        ['property', 'og:url'],
        ['name', 'twitter:card'],
        ['name', 'twitter:title'],
      ]
    : [
        ['property', 'og:title'],
        ['property', 'og:description'],
        ['property', 'og:url'],
        ['property', 'og:type'],
        ['name', 'twitter:card'],
        ['name', 'twitter:title'],
        ['name', 'twitter:description'],
        ...(routeOf(page.path) === '/cookies/'
          ? []
          : [
              ['property', 'og:image'],
              ['name', 'twitter:image'],
            ]),
      ];
  for (const [key, value] of need) {
    const v = metaContent(html, key, value);
    if (v.length === 0 || v[0] === '') p.push(`missing ${value}`);
  }
  return p;
}

const FILENAME_ALT = /\.(jpe?g|png|webp|avif|gif|svg|heic)$|^(img|dsc|dscn|dscf|pxl|p)[-_ ]?\d{3,}|^[\w-]+\.(jpe?g|png|webp)\b/i;

export function checkImages(page) {
  const p = [];
  // The lightbox <dialog> holds one image that is filled by script; it has no intrinsic size by design.
  const html = page.html.replace(/<dialog\b[\s\S]*?<\/dialog\s*>/gi, '');
  for (const tag of tagsOf(html, 'img')) {
    const a = attrsOf(tag);
    const id = a.src ?? tag.slice(0, 60);
    if (!('alt' in a)) p.push(`img ${id} has no alt attribute`);
    else if (FILENAME_ALT.test(a.alt.trim())) p.push(`img ${id} has a filename-like alt "${a.alt}"`);
    if (!/^\d+$/.test(a.width ?? '')) p.push(`img ${id} has no width`);
    if (!/^\d+$/.test(a.height ?? '')) p.push(`img ${id} has no height`);
  }
  return p;
}

const HEAVY_URL = /(?:^|\/)(?:master\.jpe?g|2400\.[a-z0-9]+)(?=$|[?#\s,])/i;
// Attributes that name exactly one URL, or a list of candidates, to be fetched whatever the viewport.
const FIXED_ATTRS = { img: ['src'], source: ['src'], link: ['href', 'imagesrcset'], video: ['poster'] };

/**
 * No master and no 2400 tier may be requested by the initial HTML (plan WP3b-18). Checked: every fixed URL
 * (img/source src, link href and imagesrcset incl. preloads, video poster, inline style url()) and the candidate
 * an eager image picks for the design-check phone (slot x DPR). Lazy srcset lists may name 2400 as a candidate for
 * big screens, and data-* attributes and plain `<a href>` are read by the lightbox script only.
 */
export function checkHeavyImages(page) {
  const p = [];
  const hit = (what, value) => {
    for (const part of String(value ?? '').split(',')) {
      const url = part.trim().split(/\s+/)[0] ?? '';
      if (HEAVY_URL.test(url)) p.push(`${what} loads ${url}, a master or 2400 URL, in the initial HTML`);
    }
  };
  for (const [name, names] of Object.entries(FIXED_ATTRS)) {
    for (const tag of tagsOf(page.html, name)) for (const n of names) hit(`<${name} ${n}>`, attrsOf(tag)[n]);
  }
  for (const url of aboveFoldImageUrls(page.html)) hit('eager image', url);
  for (const m of page.html.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) hit('css url()', m[1]);
  return p;
}

/** Required (all must appear) and allowed (nothing else may appear) top-level JSON-LD types, docs/SEO.md 5.6. */
export function jsonLdMatrix(page) {
  if (is404(page)) return { required: [], allowed: [] };
  const route = routeOf(page.path);
  // Contact is a home section (no /kontakt/ page); the Person entity lives on the About page /o-mne/ (T-293), not on the home.
  if (route === '/') return { required: ['Photographer', 'WebSite'], allowed: ['Photographer', 'WebSite'] };
  if (route === '/o-mne/') {
    return { required: ['Person', 'BreadcrumbList'], allowed: ['Person', 'BreadcrumbList', 'Photographer'] };
  }
  if (route === '/portfolio/' || route === '/cookies/') return { required: ['BreadcrumbList'], allowed: ['BreadcrumbList'] };
  return {
    required: ['ImageGallery', 'BreadcrumbList'],
    allowed: ['ImageGallery', 'BreadcrumbList', 'Photographer'],
  };
}

const FORBIDDEN_TYPES = new Set(['Review', 'AggregateRating']);

function forbiddenTypeIn(node) {
  if (Array.isArray(node)) return node.map(forbiddenTypeIn).find(Boolean) ?? null;
  if (node && typeof node === 'object') {
    const types = [].concat(node['@type'] ?? []);
    const bad = types.find((t) => FORBIDDEN_TYPES.has(t));
    if (bad) return bad;
    return Object.values(node).map(forbiddenTypeIn).find(Boolean) ?? null;
  }
  return null;
}

export function checkJsonLd(page) {
  const p = [];
  const seen = [];
  for (const raw of jsonLdBlocks(page.html)) {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      p.push('JSON-LD does not parse');
      continue;
    }
    const bad = forbiddenTypeIn(data);
    if (bad) p.push(`JSON-LD contains a ${bad}`);
    const roots = Array.isArray(data) ? data : data?.['@graph'] ? data['@graph'] : [data];
    for (const r of roots) seen.push(...[].concat(r?.['@type'] ?? []));
  }
  const { required, allowed } = jsonLdMatrix(page);
  for (const t of required) if (!seen.includes(t)) p.push(`JSON-LD type ${t} missing`);
  for (const t of seen) if (!allowed.includes(t)) p.push(`JSON-LD type ${t} not expected on this page`);
  return p;
}

export function checkRobots(page, siteEnv) {
  const content = metaContent(page.html, 'name', 'robots').join(',').toLowerCase();
  const noindex = /\bnoindex\b/.test(content);
  const production = siteEnv === 'production';
  if (is404(page)) return noindex ? [] : ['404 page must be noindex'];
  if (production && noindex) return ['noindex on an indexable page of a production build'];
  if (!production && !noindex) return [`page lacks noindex in a ${siteEnv ?? 'non-production'} build`];
  return [];
}

// ------------------------------------------------------------------ site wide checks

export function checkUnique(pages) {
  const p = [];
  const byTitle = new Map();
  const byDesc = new Map();
  for (const page of pages) {
    const t = titles(page.html)[0];
    if (t) byTitle.set(t, [...(byTitle.get(t) ?? []), where(page)]);
    const d = metaContent(page.html, 'name', 'description')[0];
    if (d) byDesc.set(d, [...(byDesc.get(d) ?? []), where(page)]);
  }
  for (const [t, ps] of byTitle) if (ps.length > 1) p.push(`title "${t}" repeated on ${ps.join(', ')}`);
  for (const [d, ps] of byDesc) if (ps.length > 1) p.push(`description "${d.slice(0, 50)}..." repeated on ${ps.join(', ')}`);
  return p;
}

function redirectSources(redirectsText) {
  const exact = new Set();
  const prefixes = [];
  for (const line of (redirectsText ?? '').split('\n')) {
    const t = line.trim();
    if (t === '' || t.startsWith('#')) continue;
    const from = t.split(/\s+/)[0];
    if (from.endsWith('*')) prefixes.push(from.slice(0, -1));
    else exact.add(from);
  }
  return { exact, prefixes };
}

export function checkInternalLinks(pages, { files, redirectsText }) {
  const p = [];
  const fileSet = new Set(files);
  const { exact, prefixes } = redirectSources(redirectsText);
  const resolves = (path) => {
    if (exact.has(path) || prefixes.some((x) => path.startsWith(x))) return true;
    const rel = path.slice(1);
    if (rel === '' || path.endsWith('/')) return fileSet.has(`${rel}index.html`);
    return fileSet.has(rel) || fileSet.has(`${rel}.html`) || fileSet.has(`${rel}/index.html`);
  };
  for (const page of pages) {
    const reported = new Set();
    for (const tag of tagsOf(page.html, 'a')) {
      const href = attrsOf(tag).href;
      if (href === undefined || !href.startsWith('/') || href.startsWith('//')) continue;
      const path = href.split('#')[0].split('?')[0];
      if (path === '' || reported.has(path)) continue;
      if (!resolves(path)) {
        reported.add(path);
        p.push(`${where(page)}: href "${href}" resolves to no page, redirect or file`);
      }
    }
  }
  return p;
}

export function sitemapLocs(sitemapXml) {
  return [...(sitemapXml ?? '').matchAll(/<loc>\s*([^<]*?)\s*<\/loc>/gi)].map((m) => decode(m[1]));
}

export function checkSitemapCanonical(pages, sitemapXml, redirectsText = '') {
  const p = [];
  if (!sitemapXml) return ['sitemap.xml is missing'];
  const locs = sitemapLocs(sitemapXml);
  if (new Set(locs).size !== locs.length) p.push('sitemap has duplicate <loc> entries');
  // A page whose route is an exact redirect source is redirect-only (e.g. /kontakt/ since T-288): not in the sitemap.
  const { exact } = redirectSources(redirectsText);
  const canon = new Set();
  for (const page of pages) {
    if (is404(page)) continue;
    if (exact.has(routeOf(page.path))) continue;
    const href = links(page.html, 'canonical')[0]?.href;
    if (href) canon.add(href);
  }
  for (const c of canon) if (!locs.includes(c)) p.push(`canonical ${c} is not in the sitemap`);
  for (const l of locs) if (!canon.has(l)) p.push(`sitemap URL ${l} has no page with that canonical`);
  return p;
}

/** Pages that still carry the `[doplnit]` marker. */
export function placeholderPages(pages) {
  return pages.filter((pg) => pg.html.includes(PLACEHOLDER)).map(where);
}

// ------------------------------------------------------------------ runner

/**
 * The fixture-only `layout-check/` pages (T-216) must never ship: fails when dist has them in a production build
 * or a build from a real snapshot (`_publish.json` source "snapshot"). Fixture/dev builds may keep them.
 */
export function checkLayoutCheckAbsent(site) {
  const present = (site.files ?? []).some((f) => f.startsWith('layout-check/'));
  if (!present) return [];
  if (site.siteEnv === 'production' || site.source === 'snapshot') {
    return [`dist/layout-check exists in a ${site.siteEnv === 'production' ? 'production' : 'snapshot'} build (fixture-only pages must not ship)`];
  }
  return [];
}

/** Runs everything. `errors` fail the check, `warnings` are printed only. */
export function runSiteChecks(site) {
  const errors = [];
  const warnings = [];
  const add = (check, list, scope = '') => {
    for (const m of list) errors.push(`${check}: ${scope}${m}`);
  };
  for (const page of site.pages) {
    add('head', checkHead(page), `${where(page)} `);
    add('images', checkImages(page), `${where(page)} `);
    add('heavy-images', checkHeavyImages(page), `${where(page)} `);
    add('json-ld', checkJsonLd(page), `${where(page)} `);
    add('robots', checkRobots(page, site.siteEnv), `${where(page)} `);
  }
  add('unique', checkUnique(site.pages));
  add('links', checkInternalLinks(site.pages, site));
  add('sitemap', checkSitemapCanonical(site.pages, site.sitemapXml, site.redirectsText));
  add('layout-check', checkLayoutCheckAbsent(site));
  const open = placeholderPages(site.pages);
  if (open.length > 0) {
    const msg = `${PLACEHOLDER} marker still on ${open.join(', ')} (cutover blocker)`;
    if (site.siteEnv === 'production') errors.push(`placeholder: ${msg}`);
    else warnings.push(msg);
  }
  return { errors, warnings };
}

/** Gate adapter: `site` is null when there is no dist. */
export function checkPageChecks(site) {
  if (!site || site.pages.length === 0) return { status: 'SKIP', details: 'no apps/web/dist found' };
  const { errors, warnings } = runSiteChecks(site);
  const warn = warnings.length ? `; WARNING ${warnings.join('; ')}` : '';
  if (errors.length > 0) {
    const shown = errors.slice(0, 5).join('; ');
    return { status: 'FAIL', details: `${errors.length} problems: ${shown}${errors.length > 5 ? '; ...' : ''}${warn}` };
  }
  return { status: 'PASS', details: `${site.pages.length} pages, ${site.siteEnv ?? 'unknown'} build${warn}` };
}

// ------------------------------------------------------------------ budget (plan WP3-23, gate `budget`)

export const LCP_IMAGE_LIMIT = 150 * KB;

const HOST_ATTRS = { img: ['src', 'srcset'], source: ['src', 'srcset'], script: ['src'], iframe: ['src'], form: ['action'], video: ['src', 'poster'], audio: ['src'], embed: ['src'], object: ['data'] };
const NON_RESOURCE_RELS = new Set(['canonical', 'alternate', 'author', 'license', 'help', 'prev', 'next']);

/** Absolute http(s) hosts that page resources (not plain `<a>` links or meta tags) point at. */
export function resourceHosts(html) {
  const hosts = new Set();
  const add = (value) => {
    for (const part of String(value ?? '').split(',')) {
      const url = part.trim().split(/\s+/)[0] ?? '';
      const m = /^(?:https?:)?\/\/([^/?#\s]+)/i.exec(url);
      if (m) hosts.add(m[1].toLowerCase());
    }
  };
  for (const [name, attrNames] of Object.entries(HOST_ATTRS)) {
    for (const tag of tagsOf(html, name)) for (const n of attrNames) add(attrsOf(tag)[n]);
  }
  for (const tag of tagsOf(html, 'link')) {
    const a = attrsOf(tag);
    const rels = (a.rel ?? '').toLowerCase().split(/\s+/);
    if (!rels.some((r) => NON_RESOURCE_RELS.has(r))) add(a.href);
  }
  return hosts;
}

export const BEACON_HOST = 'static.cloudflareinsights.com';
const TOKEN_RE = /^[A-Za-z0-9]{16,64}$/;

/** True for a production build with a valid analytics token (mirrors apps/web `analyticsToken`). */
export const hasBeacon = (siteEnv, token) => siteEnv === 'production' && TOKEN_RE.test(token ?? '');

/** Hosts the site may load resources from: itself, the image host and, with the beacon, the beacon host. */
export const allowedHosts = (imageHost, analytics = false) =>
  new Set([
    new URL(SITE_ORIGIN).host,
    ...(imageHost ? [imageHost.toLowerCase()] : []),
    ...(analytics ? [BEACON_HOST] : []),
  ]);

const kb = (n) => `${(n / KB).toFixed(1)} KB`;

/**
 * Measures first-load weight of every page of `site` (needs `site.distDir`) and returns
 * `{ errors, warnings, lines }`; `lines` print each number against its limit (Home first).
 */
export function runBudget(site) {
  const errors = [];
  const warnings = [];
  const lines = [];
  const allowed = allowedHosts(site.imageHost, site.analytics === true);
  const pages = [...site.pages].sort((a, b) => (a.path === 'index.html' ? -1 : b.path === 'index.html' ? 1 : 0));
  for (const page of pages) {
    // The 404 page is not at <route>/index.html, which measureFirstLoad expects; it is a bare page without images.
    if (is404(page)) continue;
    const route = routeOf(page.path);
    const w = measureFirstLoad({
      distDir: site.distDir,
      page: route,
      imageBytes: site.imageBytes,
    });
    const scope = `${where(page)}: `;
    for (const m of checkWeight(w)) (m.startsWith('unknown size') ? warnings : errors).push(`budget: ${scope}${m}`);
    const sizes = aboveFoldImageUrls(page.html)
      .map((u) => (u.startsWith('/') && !u.startsWith('//') ? readLocalSize(site.distDir, u) : site.imageBytes?.(u)))
      .filter((n) => n !== undefined);
    const lcp = sizes.length ? Math.max(...sizes) : 0;
    if (lcp > LCP_IMAGE_LIMIT) errors.push(`budget: ${scope}largest above-the-fold image ${lcp} B is over ${LCP_IMAGE_LIMIT} B`);
    for (const host of resourceHosts(page.html)) {
      if (!allowed.has(host)) errors.push(`budget: ${scope}resource from non-self host ${host}`);
    }
    const mark = (v, limit) => `${kb(v)} / ${kb(limit)}${v > limit ? ' OVER' : ''}`;
    lines.push(
      `${where(page).padEnd(36)} html ${mark(w.html, BUDGET.html)}; css ${mark(w.css, BUDGET.css)}; js ${mark(w.js, BUDGET.js)}; ` +
        `fonts ${w.fontFiles}/${BUDGET.fontFiles} files ${mark(w.fonts, BUDGET.fonts)}; images ${mark(w.images, BUDGET.images)}; ` +
        `lcp image ${mark(lcp, LCP_IMAGE_LIMIT)}; total ${mark(w.total, BUDGET.total)}`,
    );
  }
  return { errors, warnings, lines };
}

function readLocalSize(distDir, urlPath) {
  try {
    return readFileSync(join(distDir, decodeURIComponent(urlPath.split(/[?#]/)[0]))).length;
  } catch {
    return undefined;
  }
}

/** Gate adapter for `budget`: `site` is null (or has no distDir) when there is no dist. */
export function checkBudget(site) {
  if (!site || site.pages.length === 0 || !site.distDir) return { status: 'SKIP', details: 'no apps/web/dist found' };
  const { errors, warnings, lines } = runBudget(site);
  const warn = warnings.length ? `; WARNING ${warnings.length} eager image sizes unknown` : '';
  if (errors.length > 0) {
    const shown = errors.slice(0, 5).join('; ');
    return { status: 'FAIL', details: `${errors.length} problems: ${shown}${errors.length > 5 ? '; ...' : ''}${warn}` };
  }
  return { status: 'PASS', details: `${lines.length} pages within budget${warn}` };
}

// ------------------------------------------------------------------ loading dist

/** Every file below `dir`, relative to it, posix separators. */
export function listFiles(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath, e.name)).split(sep).join('/'));
}

/** Reads dist and what the checks need; null when there is no built home page. */
export function loadSite(distDir, walkFn = listFiles) {
  if (!existsSync(join(distDir, 'index.html'))) return null;
  const files = walkFn(distDir);
  const read = (rel) => (files.includes(rel) ? readFileSync(join(distDir, rel), 'utf8') : null);
  // layout-check/ holds the fixture-only album layout pages for design-check (T-216); they are not part of the site.
  const pages = files.filter((f) => f.endsWith('.html') && !f.startsWith('layout-check/')).map((f) => ({ path: f, html: readFileSync(join(distDir, f), 'utf8') }));
  let siteEnv = null;
  let source = null;
  try {
    const publish = JSON.parse(read('_publish.json') ?? '{}');
    siteEnv = publish.siteEnv ?? null;
    source = publish.source ?? null;
  } catch {
    siteEnv = null;
  }
  siteEnv ??= process.env.PUBLIC_SITE_ENV === 'production' ? 'production' : 'local';
  let imageHost = null;
  try {
    imageHost = new URL(process.env.PUBLIC_IMG_BASE_URL ?? '').host;
  } catch {
    imageHost = null;
  }
  const analytics = hasBeacon(siteEnv, process.env.PUBLIC_CF_ANALYTICS_TOKEN);
  return { pages, files, sitemapXml: read('sitemap.xml'), redirectsText: read('_redirects') ?? '', siteEnv, source, distDir, imageHost, analytics };
}

export function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const site = loadSite(join(root, 'apps', 'web', 'dist'));
  if (!site) {
    console.error('check:site: apps/web/dist/index.html not found; run `npm run build -w apps/web` first');
    return 2;
  }
  const { errors, warnings } = runSiteChecks(site);
  for (const w of warnings) console.log(`WARN  ${w}`);
  for (const e of errors) console.log(`FAIL  ${e}`);
  console.log(
    errors.length === 0
      ? `page-checks OK: ${site.pages.length} pages (${site.siteEnv})`
      : `page-checks FAILED: ${errors.length} problems`,
  );
  const budget = runBudget(site);
  for (const l of budget.lines) console.log(`BUDGET ${l}`);
  for (const w of budget.warnings) console.log(`WARN  ${w}`);
  for (const e of budget.errors) console.log(`FAIL  ${e}`);
  console.log(
    budget.errors.length === 0 ? `budget OK: ${site.pages.length} pages` : `budget FAILED: ${budget.errors.length} problems`,
  );
  return errors.length === 0 && budget.errors.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
