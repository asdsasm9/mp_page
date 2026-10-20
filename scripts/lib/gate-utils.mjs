// Helpers shared by scripts/gates.mjs and scripts/gates-arch.mjs. Kept apart so the two never import each other.

/** Gate result: FAIL with the offenders joined, or PASS with a message. */
export const result = (offenders, passMsg = 'ok') =>
  offenders.length ? { status: 'FAIL', details: offenders.join('; ') } : { status: 'PASS', details: passMsg };

/** At most `n` offenders, then a count of the rest. */
export const firstOffenders = (bad, n = 3) => bad.slice(0, n).concat(bad.length > n ? [`and ${bad.length - n} more`] : []);

export const MIGRATION_RE = /^supabase\/migrations\/(\d{14})_[a-z0-9_]+\.sql$/;
export const stripSqlComments = (sql) => sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');

export const ARCH_GOLDEN = 'scripts/architecture.golden.json';

/** The golden file from `files`, or a FAIL result when it is missing or not JSON. */
export function loadGolden(files) {
  const g = files.find((x) => x.path === ARCH_GOLDEN);
  if (!g) return { fail: { status: 'FAIL', details: `${ARCH_GOLDEN} missing` } };
  try {
    return { golden: JSON.parse(g.text) };
  } catch {
    return { fail: { status: 'FAIL', details: `${ARCH_GOLDEN} is not valid JSON` } };
  }
}
