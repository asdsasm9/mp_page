// docs-complete gate (WP8-18). Pure functions over `files` ({path, text}[], repo-relative posix paths).
// Imported by scripts/gates.mjs; imports only gate-utils, never gates.mjs (no cycle).
import { posix } from 'node:path';
import { SECRET_PATTERNS, firstOffenders, result } from './lib/gate-utils.mjs';

export const REQUIRED_DOCS = [
  'README.md',
  '.env.example',
  'docs/NAVOD.md',
  'docs/MAINTENANCE.md',
  'docs/BACKUP.md',
  'docs/GATES.md',
  'docs/WEB.md',
  'docs/ADMIN.md',
  'docs/DEPLOY-API.md',
  'docs/MIGRATION.md',
  'docs/DATA-MODEL.md',
  'docs/API.md',
];
/** Docs written in WP-8: held to the no-placeholder and key-scan rules. README is covered too. */
export const NEW_DOCS = ['README.md', 'docs/NAVOD.md', 'docs/MAINTENANCE.md', 'docs/BACKUP.md', 'docs/GATES.md'];
export const README_HEADINGS = ['Run', 'Test', 'Deploy', 'Cutover', 'Maintenance'];
export const GATES_DOC = 'docs/GATES.md';
const PLACEHOLDER_RE = /\b(TODO|FIXME|XXX)\b|\[doplnit\]|lorem/i;

const isLinkedDoc = (p) => p === 'README.md' || /^docs\/[^/]+\.md$/.test(p);

/** Text without fenced code blocks (their lines become empty so line counts survive). */
export function stripFences(text) {
  let fence = null;
  return text
    .split('\n')
    .map((line) => {
      const m = /^\s*(`{3,}|~{3,})/.exec(line);
      if (m) {
        if (fence === null) fence = m[1][0];
        else if (m[1][0] === fence) fence = null;
        return '';
      }
      return fence === null ? line : '';
    })
    .join('\n');
}

const stripInlineCode = (s) => s.replace(/`[^`\n]*`/g, '');

/** GitHub-style heading slug: lowercase, keep letters (diacritics too), digits, _ and -, spaces to hyphens. */
export function slugify(heading) {
  return heading
    .normalize('NFC')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/[*~]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}_\s-]/gu, '')
    .replace(/\s/g, '-');
}

/** All anchors of a markdown text; repeated headings get -1, -2 like GitHub. */
export function headingAnchors(text) {
  const seen = new Map();
  const out = new Set();
  for (const line of stripFences(text).split('\n')) {
    const m = /^ {0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const base = slugify(m[1]);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.add(n === 0 ? base : `${base}-${n}`);
  }
  return out;
}

/** Relative link targets of a markdown text (code excluded): [{target, line}]. */
export function markdownLinks(text) {
  const out = [];
  stripFences(text)
    .split('\n')
    .forEach((line, i) => {
      for (const m of stripInlineCode(line).matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
        const t = m[1];
        if (/^[a-z][a-z0-9+.-]*:/i.test(t) || t.startsWith('//') || t.startsWith('<')) continue;
        out.push({ target: t, line: i + 1 });
      }
    });
  return out;
}

const decode = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

function checkLinks(files, bad) {
  const byPath = new Map(files.map((f) => [f.path, f.text]));
  const isDir = (p) => files.some((f) => f.path.startsWith(`${p}/`));
  const anchorCache = new Map();
  for (const f of files.filter((x) => isLinkedDoc(x.path))) {
    for (const { target, line } of markdownLinks(f.text)) {
      const hash = target.indexOf('#');
      const rawPath = hash === -1 ? target : target.slice(0, hash);
      const anchor = hash === -1 ? null : decode(target.slice(hash + 1)).normalize('NFC').toLowerCase();
      const resolved = rawPath === '' ? f.path : posix.normalize(posix.join(posix.dirname(f.path), decode(rawPath)));
      const where = `${f.path}:${line}`;
      const exists = byPath.has(resolved) || isDir(resolved.replace(/\/$/, ''));
      // binaries (images, pdf) are not loaded into `files`; trust a link to one only if it is a known binary type
      if (!exists && !/\.(jpe?g|png|webp|avif|gif|ico|woff2?|pdf|zip|tgz)$/i.test(resolved)) {
        bad.push(`${where} dead link ${target}`);
        continue;
      }
      if (anchor !== null && anchor !== '' && /\.md$/.test(resolved) && byPath.has(resolved)) {
        if (!anchorCache.has(resolved)) anchorCache.set(resolved, headingAnchors(byPath.get(resolved)));
        if (!anchorCache.get(resolved).has(anchor)) bad.push(`${where} dead anchor ${target}`);
      }
    }
  }
}

/** Names after `npm run` in prose and code; `-w <workspace>` forms belong to a workspace and are skipped. */
export function npmRunNames(text) {
  const out = [];
  for (const m of text.matchAll(/npm run ([A-Za-z0-9][A-Za-z0-9:_-]*)((?:(?!npm run)[^\n])*)/g)) {
    if (/^\s+(-w|--workspace)\b/.test(m[2])) continue;
    out.push(m[1]);
  }
  return out;
}

function checkNpmScripts(files, bad) {
  const pkg = files.find((f) => f.path === 'package.json');
  let scripts = {};
  try {
    scripts = JSON.parse(pkg?.text ?? '{}').scripts ?? {};
  } catch {
    bad.push('package.json is not valid JSON');
  }
  for (const f of files.filter((x) => isLinkedDoc(x.path))) {
    for (const name of new Set(npmRunNames(f.text))) {
      if (!(name in scripts)) bad.push(`${f.path} names unknown npm script "${name}"`);
    }
  }
}

/** Rows of docs/GATES.md: the backticked name in the first table cell. */
export function gatesDocRows(text) {
  return [...text.matchAll(/^\|\s*`([a-z0-9-]+)`\s*\|/gm)].map((m) => m[1]);
}

/** docs/GATES.md has exactly one row per check name (no missing, no unknown, no duplicate). */
export function checkGatesRows(files, checkNames) {
  const doc = files.find((f) => f.path === GATES_DOC);
  if (!doc) return { status: 'FAIL', details: `${GATES_DOC} missing` };
  const rows = gatesDocRows(doc.text);
  const bad = [];
  for (const n of checkNames) if (!rows.includes(n)) bad.push(`${GATES_DOC} has no row for ${n}`);
  for (const r of new Set(rows)) if (!checkNames.includes(r)) bad.push(`${GATES_DOC} row ${r} is not a check`);
  for (const r of rows) if (rows.indexOf(r) !== rows.lastIndexOf(r) && !bad.some((b) => b.includes(`${r} listed`))) bad.push(`${GATES_DOC} lists ${r} twice`);
  return result(firstOffenders(bad), `${rows.length} rows equal the check list`);
}

/**
 * docs-complete: required docs exist, README sections, links and anchors resolve, no placeholders in the new docs,
 * every `npm run X` is a root script, GATES.md has a row per check, no key-shaped strings in the new docs.
 * `checkNames` is the registry's name list (passed in by gates.mjs to avoid a cycle).
 */
export function checkDocsComplete(files, checkNames = []) {
  const bad = [];
  const has = (p) => files.some((f) => f.path === p);
  for (const p of REQUIRED_DOCS) if (!has(p)) bad.push(`${p} missing`);

  const readme = files.find((f) => f.path === 'README.md');
  if (readme) {
    const heads = stripFences(readme.text)
      .split('\n')
      .map((l) => /^#{1,6}\s+(.*)$/.exec(l)?.[1].trim().toLowerCase())
      .filter(Boolean);
    for (const h of README_HEADINGS) {
      if (!heads.some((x) => x === h.toLowerCase() || x.startsWith(`${h.toLowerCase()} `))) bad.push(`README.md has no "${h}" heading`);
    }
    if (!readme.text.includes('H-5')) bad.push('README.md does not mention H-5');
  }

  checkLinks(files, bad);

  for (const f of files.filter((x) => NEW_DOCS.includes(x.path) && x.path.endsWith('.md'))) {
    f.text.split('\n').forEach((line, i) => {
      const m = PLACEHOLDER_RE.exec(line);
      if (m) bad.push(`${f.path}:${i + 1} placeholder "${m[0]}"`);
    });
    for (const [label, re] of SECRET_PATTERNS) if (re.test(f.text)) bad.push(`${f.path} (${label})`);
  }

  checkNpmScripts(files, bad);

  if (has(GATES_DOC) && checkNames.length) {
    const r = checkGatesRows(files, checkNames);
    if (r.status === 'FAIL') bad.push(r.details);
  }
  return result(firstOffenders(bad, 4), `${REQUIRED_DOCS.length} required docs, links, scripts and ${checkNames.length} gate rows ok`);
}
