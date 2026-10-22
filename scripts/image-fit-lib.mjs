// Pure parts of the image-fit check (no Chrome, no network): argument parsing, the fit rule, table, exit code.
// Rule (plan WP-03b step 9): for every photo, natural width >= rendered width x DPR (no upscaling blur) and
// <= OVERFETCH_LIMIT x that (no heavy overfetch); layout shift (CLS) must be 0.
// A tier ladder cannot always satisfy both ends: when the browser already took the smallest tier the overfetch
// cannot be avoided ("floor"), and when it took the largest tier there is nothing bigger ("cap"). Those two cases
// are reported but do not fail the run.

export const EXIT = { PASS: 0, FAIL: 1, SKIPPED: 2 };
export const FIT_WIDTHS = [360, 412, 768, 1280, 1920];
export const FIT_DPRS = [1, 2, 3];
export const FIT_ROUTES = ['/', '/svatby/', '/svatby/sedlakovi/'];
export const OVERFETCH_LIMIT = 1.6;
/** Rounding slack in pixels: a rendered width of 379.6 x 1.75 needs 664.3, a 664 px file is fine. */
export const SLACK_PX = 1;

export function parseFitArgs(argv) {
  const opts = { routes: FIT_ROUTES, widths: FIT_WIDTHS, dprs: FIT_DPRS, dist: 'apps/web/dist', from: null, placeholders: null, json: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const take = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`missing value for ${a}`);
      return v;
    };
    const nums = (s) => {
      const l = s.split(',').map(Number);
      if (!l.length || l.some((n) => !Number.isFinite(n) || n <= 0)) throw new Error(`${a} needs comma separated positive numbers`);
      return l;
    };
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--routes') {
      const l = take().split(',').map((s) => s.trim()).filter(Boolean);
      if (!l.length || l.some((r) => !r.startsWith('/'))) throw new Error('--routes needs comma separated paths starting with /');
      opts.routes = l;
    } else if (a === '--widths') opts.widths = nums(take());
    else if (a === '--dprs') opts.dprs = nums(take());
    else if (a === '--dist') opts.dist = take();
    else if (a === '--from') opts.from = take();
    else if (a === '--placeholders') opts.placeholders = take();
    else if (a === '--json') opts.json = take();
    else throw new Error(`unknown argument ${a}`);
  }
  return opts;
}

/** Widths (w descriptors) listed in a srcset string, ascending. */
export function srcsetWidths(srcset) {
  return [...String(srcset ?? '').matchAll(/\s(\d+)w\b/g)].map((m) => Number(m[1])).sort((a, b) => a - b);
}

/**
 * Judge one image. photo = { naturalWidth, renderedWidth, dpr, tiers: number[] } (tiers = srcset widths).
 * Returns { need, ratio, status: 'ok'|'floor'|'cap'|'ladder'|'blur'|'heavy', ok }.
 * 'ladder' = over the limit but no smaller tier satisfies the need (tier gap, accepted by D-8: quality first).
 */
export function judgePhoto({ naturalWidth, renderedWidth, dpr, tiers = [] }) {
  const need = renderedWidth * dpr;
  const ratio = need > 0 ? naturalWidth / need : Infinity;
  const smallest = tiers.length ? Math.min(...tiers) : null;
  const largest = tiers.length ? Math.max(...tiers) : null;
  let status = 'ok';
  if (naturalWidth + SLACK_PX < need) status = largest !== null && naturalWidth >= largest ? 'cap' : 'blur';
  else if (naturalWidth > need * OVERFETCH_LIMIT) {
    if (smallest !== null && naturalWidth <= smallest) status = 'floor';
    // Tier-ladder gap: no smaller tier would have satisfied the need, so the chosen one is the smallest sharp choice.
    else if (tiers.length && !tiers.some((t) => t < naturalWidth && t + SLACK_PX >= need)) status = 'ladder';
    else status = 'heavy';
  }
  return { need, ratio, status, ok: status === 'ok' || status === 'floor' || status === 'cap' || status === 'ladder' };
}

/** One result per (route, width, dpr): { route, width, dpr, cls, photos: [{naturalWidth, renderedWidth, tiers}] }. */
export function evaluate(measurements) {
  const rows = [];
  const failures = [];
  for (const m of measurements) {
    const judged = m.photos.map((p) => ({ ...p, ...judgePhoto({ ...p, dpr: m.dpr }) }));
    const bad = judged.filter((j) => !j.ok);
    const notes = judged.filter((j) => j.status === 'floor' || j.status === 'cap' || j.status === 'ladder');
    const row = {
      route: m.route, width: m.width, dpr: m.dpr, cls: m.cls, count: judged.length,
      need: judged.length ? Math.round(median(judged.map((j) => j.need))) : 0,
      picked: [...new Set(judged.map((j) => j.naturalWidth))].sort((a, b) => a - b),
      minRatio: judged.length ? Math.min(...judged.map((j) => j.ratio)) : NaN,
      maxRatio: judged.length ? Math.max(...judged.map((j) => j.ratio)) : NaN,
      notes: notes.length, bad: bad.length,
    };
    rows.push(row);
    if (!judged.length) failures.push(`${m.route} ${m.width}px DPR ${m.dpr}: no photos measured`);
    if (bad.length) {
      const worst = bad[0];
      failures.push(`${m.route} ${m.width}px DPR ${m.dpr}: ${bad.length} photo(s) ${worst.status} (natural ${worst.naturalWidth}, rendered ${worst.renderedWidth.toFixed(1)} x ${m.dpr} = ${worst.need.toFixed(1)}, ratio ${worst.ratio.toFixed(2)})`);
    }
    if (m.cls > 0) failures.push(`${m.route} ${m.width}px DPR ${m.dpr}: CLS ${m.cls.toFixed(4)} > 0`);
  }
  return { rows, failures, exitCode: failures.length ? EXIT.FAIL : EXIT.PASS };
}

function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const pad = (v, n) => String(v).padEnd(n);

/** Plain-text table, one line per (route, width, dpr). */
export function formatTable(rows) {
  const head = `${pad('route', 20)}${pad('width', 6)}${pad('dpr', 6)}${pad('imgs', 5)}${pad('need px', 8)}${pad('picked', 22)}${pad('ratio min..max', 16)}${pad('cls', 7)}result`;
  const lines = rows.map((r) => {
    const result = r.bad ? `FAIL(${r.bad})` : r.notes ? `ok (${r.notes} floor/cap/ladder)` : 'ok';
    const ratio = Number.isFinite(r.minRatio) ? `${r.minRatio.toFixed(2)}..${r.maxRatio.toFixed(2)}` : '-';
    return `${pad(r.route, 20)}${pad(r.width, 6)}${pad(r.dpr, 6)}${pad(r.count, 5)}${pad(r.need, 8)}${pad(r.picked.join('/'), 22)}${pad(ratio, 16)}${pad(r.cls.toFixed(3), 7)}${result}`;
  });
  return [head, ...lines].join('\n');
}

export function verdictLine(exitCode) {
  return exitCode === EXIT.PASS ? 'IMAGE_FIT: PASS' : exitCode === EXIT.SKIPPED ? 'IMAGE_FIT: SKIPPED' : 'IMAGE_FIT: FAIL';
}
