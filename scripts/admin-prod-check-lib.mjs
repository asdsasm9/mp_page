// Pure parts of admin-prod-check (WP5-29): bundle report and the judges. No browser in here, so
// admin-prod-check.test.mjs can feed them synthetic inputs and prove that an over-budget bundle, a missing CSP header,
// an unexpected CSP violation or a missing positive control make the check fail.
import { gzipSync } from 'node:zlib';

export const INITIAL_JS_GZIP_LIMIT = 300 * 1024; // plan WP5-29; perf-budget default for public pages is 170 KB
export const INITIAL_CSS_GZIP_LIMIT = 50 * 1024;

/** Files the browser needs before the app starts: module scripts, modulepreload links, stylesheets of index.html. */
export function initialAssets(html) {
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
  const preloads = [...html.matchAll(/<link\b[^>]*\brel="modulepreload"[^>]*\bhref="([^"]+)"/g)].map((m) => m[1]);
  const css = [...html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"/g)].map((m) => m[1]);
  return { js: [...new Set([...scripts, ...preloads])], css: [...new Set(css)] };
}

export const gzipSize = (buf) => gzipSync(buf).length;

/**
 * rows: [{ file, raw, gzip, initial }] -> totals and the failures against the budget.
 * The JS budget counts every chunk: the real-adapter chunk is a dynamic import but is always fetched at start-up in a
 * production build, so leaving it out would flatter the number. `initialJs*` is the entry chunk alone (informational).
 */
export function judgeBundle(rows) {
  const sum = (kind, field, onlyInitial) => rows.filter((r) => (!onlyInitial || r.initial) && r.file.endsWith(kind)).reduce((n, r) => n + r[field], 0);
  const totals = {
    jsRaw: sum('.js', 'raw', false),
    jsGzip: sum('.js', 'gzip', false),
    initialJsRaw: sum('.js', 'raw', true),
    initialJsGzip: sum('.js', 'gzip', true),
    cssRaw: sum('.css', 'raw', true),
    cssGzip: sum('.css', 'gzip', true),
  };
  const failures = [];
  if (totals.jsGzip >= INITIAL_JS_GZIP_LIMIT) failures.push(`JS ${totals.jsGzip} B gzip is not under ${INITIAL_JS_GZIP_LIMIT} B`);
  if (totals.cssGzip >= INITIAL_CSS_GZIP_LIMIT) failures.push(`initial CSS ${totals.cssGzip} B gzip is not under ${INITIAL_CSS_GZIP_LIMIT} B`);
  if (rows.filter((r) => r.initial && r.file.endsWith('.js')).length === 0) failures.push('index.html references no script');
  return { totals, failures };
}

/** The admin must never carry the public site's analytics beacon (plan WP-7 section 5). files: [{ file, text }]. */
export const ANALYTICS_RE = /cloudflareinsights|data-cf-beacon|beacon\.min\.js/i;
export function judgeNoAnalytics(files) {
  return files.filter((f) => ANALYTICS_RE.test(f.text)).map((f) => `${f.file} references the Cloudflare analytics beacon`);
}

/** The document's response headers: the CSP must be there and carry the hardening directives. */
export function judgeDocumentHeaders(headers) {
  const bad = [];
  const csp = headers['content-security-policy'];
  if (!csp) return ['document has no Content-Security-Policy header'];
  if (/\*|unsafe-/.test(csp)) bad.push(`CSP has a wildcard or unsafe-*: ${csp}`);
  // Google sign-in is a top-level navigation, so the policy needs no Google origin (WP-09 section 6).
  if (/google/i.test(csp)) bad.push(`CSP must not mention google: ${csp}`);
  if (!/frame-ancestors 'none'/.test(csp)) bad.push("CSP lacks frame-ancestors 'none'");
  if (!/noindex/.test(headers['x-robots-tag'] ?? '')) bad.push('no X-Robots-Tag noindex');
  return bad;
}

/**
 * `violations` = securitypolicyviolation events [{ directive, blocked }] seen while the app ran (before the probes),
 * `probes` = the deliberate checks { allowed: [{ name, ok }], blocked: [{ name, directive, seen }] }.
 */
export function judgeCsp(violations, probes) {
  const bad = violations.map((v) => `CSP violation in the app: ${v.directive} blocked ${v.blocked}`);
  for (const p of probes.allowed) if (!p.ok) bad.push(`allowed origin was refused: ${p.name}`);
  for (const p of probes.blocked) {
    if (!p.seen) bad.push(`CSP is not enforced: ${p.name} was not reported as a ${p.directive} violation`);
  }
  return bad;
}
