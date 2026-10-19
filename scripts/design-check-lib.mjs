// Pure parts of design-check (no Chrome, no network): argument parsing, Lighthouse summary, evaluation, exit codes.
// Thresholds follow plan section 4.10.

export const EXIT = { PASS: 0, FAIL: 1, SKIPPED: 2 };

export const THRESHOLDS = {
  performance: 0.95,
  accessibility: 1,
  'best-practices': 1,
  seo: 1,
  lcp: 2500,
  cls: 0.1,
};

export const WIDTHS = [360, 768, 1280];
export const REFLOW_WIDTH = 320;
export const RUNS = 3;

/** The five page types plus the light-pass pages. `light: true` means axe only (no Lighthouse). */
export const ROUTES = [
  { path: '/', name: 'home' },
  { path: '/svatby/', name: 'category' },
  { path: '/svatby/sedlakovi/', name: 'album' },
  { path: '/o-mne/', name: 'about' },
  { path: '/kontakt/', name: 'contact' },
  { path: '/cookies/', name: 'cookies', light: true },
  { path: '/neexistuje/', name: '404', light: true },
];

/** `--routes /a/,/b/ --runs 1 --out dir --dist dir`; throws on unknown flags or bad values. */
export function parseArgs(argv) {
  const opts = { routes: null, runs: RUNS, out: '.tmp/design-check', dist: 'apps/web/dist', help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const take = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`missing value for ${a}`);
      return v;
    };
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--routes') {
      const list = take().split(',').map((s) => s.trim()).filter(Boolean);
      if (!list.length || list.some((r) => !r.startsWith('/'))) throw new Error('--routes needs comma separated paths starting with /');
      opts.routes = list;
    } else if (a === '--runs') {
      const n = Number(take());
      if (!Number.isInteger(n) || n < 1 || n > 9) throw new Error('--runs must be an integer from 1 to 9');
      opts.runs = n;
    } else if (a === '--out') opts.out = take();
    else if (a === '--dist') opts.dist = take();
    else throw new Error(`unknown argument ${a}`);
  }
  return opts;
}

/** Routes to check: all defaults, or the requested paths (known ones keep their name and light flag). */
export function selectRoutes(requested) {
  if (!requested) return ROUTES;
  return requested.map((path) => ROUTES.find((r) => r.path === path) ?? { path, name: path.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home' });
}

export function median(nums) {
  if (!nums.length) return NaN;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * SEO category score recomputed without the is-crawlable audit. Non-production builds are noindex by design
 * (plan 4.1), which would cap the score at 0.69 forever; indexability of the production build is covered by
 * the build guard and the cutover checklist, not by this lab run.
 */
export function seoIgnoringCrawlable(lhr) {
  const refs = lhr.categories?.seo?.auditRefs;
  if (!Array.isArray(refs)) return lhr.categories?.seo?.score ?? null;
  let sum = 0;
  let weight = 0;
  for (const ref of refs) {
    if (ref.id === 'is-crawlable' || !ref.weight) continue;
    const a = lhr.audits?.[ref.id];
    if (!a || a.score === null || a.scoreDisplayMode === 'notApplicable' || a.scoreDisplayMode === 'manual' || a.scoreDisplayMode === 'informative') continue;
    sum += a.score * ref.weight;
    weight += ref.weight;
  }
  return weight ? sum / weight : null;
}

/**
 * Keyboard pass stops: [{ label, outlineStyle, outlineWidth, boxShadow, obscured, inViewport }] in Tab order.
 * Problems: no visible focus indicator (WCAG 2.4.7), focused element covered by another element (2.4.11), no stops at all.
 */
export function evaluateKeyboard(route, stops) {
  if (!stops.length) return [`${route}: keyboard pass found nothing focusable`];
  const out = [];
  for (const s of stops) {
    const outline = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0;
    if (!outline && (!s.boxShadow || s.boxShadow === 'none')) out.push(`${route}: no visible focus indicator on ${s.label}`);
    if (s.obscured) out.push(`${route}: focused ${s.label} is covered by another element`);
  }
  return out;
}

/** A 404 page is served with status 404; Chrome logs that as a console error for the document itself. Drop only that one. */
export function isExpectedConsoleError(route, msg, pageUrl) {
  return route.name === '404' && /status of 404/.test(msg.text) && msg.url === pageUrl;
}

/** Reduce one Lighthouse JSON report (lhr) to the numbers we judge. */
export function summarizeLhr(lhr) {
  const cat = (id) => lhr.categories?.[id]?.score ?? null;
  const num = (id) => lhr.audits?.[id]?.numericValue ?? null;
  return {
    performance: cat('performance'),
    accessibility: cat('accessibility'),
    'best-practices': cat('best-practices'),
    seo: seoIgnoringCrawlable(lhr),
    // Raw crawlability (is-crawlable): 0 on every non-production build because those are noindex on purpose.
    crawlable: lhr.audits?.['is-crawlable']?.score ?? null,
    lcp: num('largest-contentful-paint'),
    cls: num('cumulative-layout-shift'),
    tbt: num('total-blocking-time'),
  };
}

/** Median of each metric over several summaries. */
export function medianSummary(summaries) {
  const out = {};
  for (const key of Object.keys(summaries[0] ?? {})) {
    const vals = summaries.map((s) => s[key]).filter((v) => typeof v === 'number');
    out[key] = vals.length ? median(vals) : null;
  }
  return out;
}

/** Judge a Lighthouse summary; returns problem strings. A missing metric is a problem, never a pass. */
export function evaluateLighthouse(route, s, t = THRESHOLDS) {
  const out = [];
  for (const id of ['performance', 'accessibility', 'best-practices', 'seo']) {
    if (typeof s[id] !== 'number') out.push(`${route}: ${id} score missing`);
    else if (s[id] < t[id]) out.push(`${route}: ${id} ${s[id]} < ${t[id]}`);
  }
  if (typeof s.lcp !== 'number') out.push(`${route}: LCP missing`);
  else if (s.lcp > t.lcp) out.push(`${route}: LCP ${Math.round(s.lcp)}ms > ${t.lcp}ms`);
  if (typeof s.cls !== 'number') out.push(`${route}: CLS missing`);
  else if (s.cls > t.cls) out.push(`${route}: CLS ${s.cls.toFixed(3)} > ${t.cls}`);
  return out;
}

/** axe violations: serious and critical fail, the rest are only listed by the caller. */
export function evaluateAxe(route, violations) {
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${route}: axe ${v.impact} ${v.id} (${v.nodes?.length ?? 0} nodes)`);
}

export function evaluateReflow(route, overflowPx) {
  return overflowPx > 0 ? [`${route}: horizontal scroll at ${REFLOW_WIDTH}px (${overflowPx}px)`] : [];
}

export function evaluateConsole(route, messages) {
  return messages.map((m) => `${route}: console error: ${m}`);
}

/**
 * Combine per route results: { route, light?, lighthouse?, axe: [], overflow, consoleErrors: [] }.
 * Returns { failures, verdict, exitCode }.
 */
export function aggregate(results, t = THRESHOLDS) {
  const failures = [];
  for (const r of results) {
    if (!r.light) failures.push(...evaluateLighthouse(r.route, r.lighthouse ?? {}, t));
    failures.push(...evaluateAxe(r.route, r.axe ?? []));
    failures.push(...evaluateReflow(r.route, r.overflow ?? 0));
    if (r.keyboard) failures.push(...evaluateKeyboard(r.route, r.keyboard));
    failures.push(...evaluateConsole(r.route, r.consoleErrors ?? []));
  }
  if (!results.length) failures.push('no routes were checked');
  const verdict = failures.length ? 'FAIL' : 'PASS';
  return { failures, verdict, exitCode: failures.length ? EXIT.FAIL : EXIT.PASS };
}

export const SKIPPED_MESSAGE = 'SKIPPED: Chrome not found (set CHROME_PATH to a Chrome or Chromium executable)';

/** Final line printed by the runner. */
export function verdictLine(verdict) {
  return verdict === 'SKIPPED' ? 'DESIGN_CHECK: SKIPPED' : `DESIGN_CHECK: ${verdict}`;
}
