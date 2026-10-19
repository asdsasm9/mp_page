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

/** Reduce one Lighthouse JSON report (lhr) to the numbers we judge. */
export function summarizeLhr(lhr) {
  const cat = (id) => lhr.categories?.[id]?.score ?? null;
  const num = (id) => lhr.audits?.[id]?.numericValue ?? null;
  return {
    performance: cat('performance'),
    accessibility: cat('accessibility'),
    'best-practices': cat('best-practices'),
    seo: cat('seo'),
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
