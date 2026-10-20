// Helpers shared by scripts/gates.mjs and scripts/gates-arch.mjs. Kept apart so the two never import each other.

/** Gate result: FAIL with the offenders joined, or PASS with a message. */
export const result = (offenders, passMsg = 'ok') =>
  offenders.length ? { status: 'FAIL', details: offenders.join('; ') } : { status: 'PASS', details: passMsg };

/** At most `n` offenders, then a count of the rest. */
export const firstOffenders = (bad, n = 3) => bad.slice(0, n).concat(bad.length > n ? [`and ${bad.length - n} more`] : []);

export const MIGRATION_RE = /^supabase\/migrations\/(\d{14})_[a-z0-9_]+\.sql$/;
export const stripSqlComments = (sql) => sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');

/** Glob (`**`, `*`, `?`) to an anchored RegExp over '/'-separated repo paths. */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      i++;
      if (glob[i + 1] === '/') (i++, (re += '(?:.*/)?'));
      else re += '.*';
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/** Source text without block and whole-line `//` comments (TS/JS/MJS). */
// A block comment opens only after whitespace or a brace/semicolon, so a string such as '/*' does not start one.
export const stripCodeComments = (s) => s.replace(/(^|[\s;{}])\/\*[\s\S]*?\*\//g, '$1 ').replace(/^\s*\/\/.*$/gm, ' ');

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
