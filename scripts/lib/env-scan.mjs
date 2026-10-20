// Env-name scanner (WP8-1). Pure: scanEnvNames(files) => sorted unique names the production code reads.
// files: {path, text}[] with repo-relative posix paths (same shape as scripts/gates.mjs).
// Static text scan: catches drift, not a determined bypass (a name built at runtime is invisible). Residual risk
// is accepted in WP-08 section 9; the real-repo known-names test in scripts/env-scan.test.mjs is the second guard.
//
// Recognised forms (comments are blanked first, so prose and usage lines never count):
//   import.meta.env.X   process.env.X   env.X   raw.X   meta.X   proc.X      (also with ['X'] and ?. access)
//   const { X, Y: z = 1 } = process.env | import.meta.env | env | raw
//   req('X'  text(env, 'X'  get('X'  pick('X'                                  (read helpers)
//   any quoted whole-string NAME in name-list files: env.ts, headers.ts, *.config.*  (e.g. ['VITE_X', 'key'])

/** Upper-case env variable name, at least two characters. */
const NAME = '(?=[A-Z0-9_]{2})[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*';
const NAME_RE = new RegExp(`^${NAME}$`);
const RECEIVER = '(?:import\\.meta\\.env|process\\.env|env|raw|meta|proc)';

const isTest = (p) =>
  /\.(test|spec)\.[cm]?[jt]sx?$/.test(p) ||
  /(^|\/)(test|tests|__tests__|__golden__|__mocks__)\//.test(p) ||
  /(^|\/)test-support\.[cm]?[jt]s$/.test(p);

/** Production code scope: apps/* src and root config files, packages/* src, scripts/**; tests excluded. */
export function isEnvScope(path) {
  if (!/\.(ts|tsx|mjs|cjs|js|astro)$/.test(path)) return false;
  if (path.includes('node_modules/') || /(^|\/)(dist|\.astro|\.tmp)\//.test(path)) return false;
  if (isTest(path)) return false;
  return (
    /^apps\/[^/]+\/src\//.test(path) ||
    /^apps\/[^/]+\/[^/]+\.(ts|mjs)$/.test(path) ||
    /^packages\/[^/]+\/src\//.test(path) ||
    path.startsWith('scripts/') ||
    /^[^/]+\.config\.(ts|mjs|js)$/.test(path)
  );
}

/** Files whose quoted whole-string upper-case literals are env names (name lists, header generators, configs). */
const isNameListFile = (p) => /(^|\/)(env\.(ts|mjs)|headers\.(ts|mjs)|[^/]*\.config\.(ts|mjs|js))$/.test(p);

/** Blank comments (keeps strings and URLs). A `//` or `/*` only opens a comment after whitespace or a delimiter. */
export function stripComments(text) {
  return text
    .replace(/(^|[\s;{(,])\/\*[\s\S]*?\*\//g, (m, lead) => lead + ' ')
    .replace(/(^|[\s;{(,])\/\/[^\n]*/g, (m, lead) => lead);
}

const dotAccess = new RegExp(`\\b${RECEIVER}\\??\\.(${NAME})\\b`, 'g');
const indexAccess = new RegExp(`\\b${RECEIVER}\\??\\.?\\[\\s*['"\`](${NAME})['"\`]\\s*\\]`, 'g');
const destructure = new RegExp(`\\{([^{}]*)\\}\\s*=\\s*${RECEIVER}\\b`, 'g');
const helperCall = new RegExp(`\\b(?:req|get|pick|text|read|getEnv)\\s*\\(\\s*(?:\\w+\\s*,\\s*)?['"\`](${NAME})['"\`]`, 'g');
// Only as an array element or call argument (`['VITE_X', 'key']`, `fn('X', v)`), not `code = 'BUILD_CONFIG'`.
const quotedName = new RegExp(`(?<=[\\[(,]\\s*)['"\`](${NAME})['"\`]`, 'g');

function namesIn(text, nameList) {
  const found = new Set();
  const add = (n) => n && NAME_RE.test(n) && found.add(n);
  for (const m of text.matchAll(dotAccess)) add(m[1]);
  for (const m of text.matchAll(indexAccess)) add(m[1]);
  for (const m of text.matchAll(helperCall)) add(m[1]);
  for (const m of text.matchAll(destructure)) {
    for (const part of m[1].split(',')) add(part.trim().split(/[:=\s]/)[0]);
  }
  if (nameList) for (const m of text.matchAll(quotedName)) add(m[1]);
  return found;
}

/** Map name -> sorted paths that read it. */
export function scanEnvUsage(files) {
  const usage = new Map();
  for (const f of files) {
    if (!isEnvScope(f.path)) continue;
    for (const name of namesIn(stripComments(f.text), isNameListFile(f.path))) {
      if (!usage.has(name)) usage.set(name, []);
      usage.get(name).push(f.path);
    }
  }
  for (const paths of usage.values()) paths.sort();
  return usage;
}

/** Sorted unique env names read by production code. */
export function scanEnvNames(files) {
  return [...scanEnvUsage(files).keys()].sort();
}
