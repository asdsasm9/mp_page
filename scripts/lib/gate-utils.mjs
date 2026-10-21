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

/**
 * Source text without real line and block comments (TS/JS/MJS). A small scanner tracks '...', "...", `...` strings
 * (backslash escapes; `${` inside a template is code again), so comment markers inside strings are kept and code after
 * them is still visible. Unterminated ' and " strings end at the line break. Regex literals are not parsed (a quote inside
 * one only affects the rest of its line). KNOWN LIMITATION: a regex literal containing // or /* can hide code. Only
 * presence-asserting gates may use this (a hidden region can only cause a false FAIL there). Comments become a space; line breaks are kept.
 */
export function stripCodeComments(s) {
  let out = '';
  const stack = []; // template nesting: brace depth to return to
  let i = 0;
  let braces = 0;
  let tpl = false; // inside template text
  while (i < s.length) {
    const c = s[i];
    const n = s[i + 1];
    if (tpl) {
      if (c === '\\') { out += s.slice(i, i + 2); i += 2; continue; }
      if (c === '`') { tpl = false; out += c; i++; continue; }
      if (c === '$' && n === '{') { stack.push(braces); braces = 0; tpl = false; out += '${'; i += 2; continue; }
      out += c; i++; continue;
    }
    if (c === '/' && n === '/') {
      while (i < s.length && s[i] !== '\n') i++;
      out += ' ';
      continue;
    }
    if (c === '/' && n === '*') {
      const end = s.indexOf('*/', i + 2);
      const stop = end === -1 ? s.length : end + 2;
      out += ' ' + s.slice(i, stop).replace(/[^\n]/g, '');
      i = stop;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== c && s[j] !== '\n') j += s[j] === '\\' ? 2 : 1;
      const stop = s[j] === c ? j + 1 : j;
      out += s.slice(i, stop);
      i = stop;
      continue;
    }
    if (c === '`') { tpl = true; out += c; i++; continue; }
    if (c === '{') braces++;
    if (c === '}') {
      if (braces === 0 && stack.length) { braces = stack.pop(); tpl = true; out += c; i++; continue; }
      braces--;
    }
    out += c;
    i++;
  }
  return out;
}

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
