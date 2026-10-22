// Gate registry. Each check is a pure function (files) => {status, details}.
// files: {path, text}[] with repo-relative posix paths.
// Statuses: PASS | FAIL | PENDING | SKIP. `--strict` makes PENDING count as FAIL.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  checkArchApiSurface,
  checkArchComponents,
  checkArchDataModel,
  checkArchHostingFiles,
  checkArchStorageKeys,
  checkArchTestsPresent,
} from './gates-arch.mjs';
import { scanEnvUsage } from './lib/env-scan.mjs';
import { checkDocsComplete } from './gates-docs.mjs';
import { MIGRATION_RE, SECRET_PATTERNS, result, stripSqlComments } from './lib/gate-utils.mjs';
import { attrsOf, checkBudget, checkPageChecks, loadSite } from './site-checks.mjs';

const SELF = ['scripts/gates.mjs', 'scripts/gates.test.mjs', 'scripts/lib/gate-utils.mjs'];
const isSelf = (p) => SELF.includes(p);
const under = (p, ...prefixes) => prefixes.some((x) => p.startsWith(x));
const isLockfile = (p) => p.endsWith('package-lock.json');

function findMatches(files, skip, patterns) {
  const out = [];
  for (const f of files) {
    if (skip(f.path)) continue;
    for (const [label, re] of patterns) {
      if (re.test(f.text)) out.push(`${f.path} (${label})`);
    }
  }
  return out;
}

export function checkNoSecrets(files) {
  return result(
    findMatches(files, (p) => isSelf(p) || isLockfile(p) || under(p, 'legacy/', 'docs/'), SECRET_PATTERNS),
  );
}

export function checkNoServiceRole(files) {
  return result(
    findMatches(
      files,
      (p) => isSelf(p) || under(p, 'docs/', 'legacy/', 'supabase/'),
      [['service_role', /service_role/i]],
    ),
  );
}

export function checkNoEnvFiles(files) {
  const bad = files
    .map((f) => f.path)
    .filter((p) => {
      const base = p.split('/').pop();
      return (base === '.env' || base.startsWith('.env.') || base === '.dev.vars') && base !== '.env.example';
    });
  return result(bad);
}

export function checkEnvExampleSane(files, allowedDefaults = {}) {
  const f = files.find((x) => x.path === '.env.example');
  if (!f) return { status: 'FAIL', details: '.env.example missing' };
  const bad = [];
  f.text.split('\n').forEach((line, i) => {
    const t = line.trim();
    if (t === '' || t.startsWith('#')) return;
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(t);
    if (!m) return bad.push(`line ${i + 1}: not NAME=`);
    if (m[2] !== '' && allowedDefaults[m[1]] !== m[2]) bad.push(`line ${i + 1}: ${m[1]} has a value`);
  });
  return result(bad);
}

// ---------------------------------------------------------------------------------------------- env completeness (WP8-2)
/**
 * Names that .env.example documents although no production code reads them. Keep this list small: every entry needs a
 * reason here and a `# docs-only: <reason>` comment line directly above the name in .env.example.
 */
export const ENV_DOCS_ONLY = {
  ADMIN_CHECK_BROWSER: 'read only by scripts/admin-check.test.mjs (browser mutation test)',
  ADMIN_ENCODE_BROWSER: 'read only by scripts/admin-encode-check.test.mjs (browser mutation test)',
};

/**
 * .env.example lists exactly the names production code reads (scripts/lib/env-scan.mjs), each once, each with a
 * comment line directly above it. A documented name nothing reads must be a ENV_DOCS_ONLY entry with a matching
 * `# docs-only:` comment; a stale exception (the code now reads it) fails too.
 */
export function checkEnvExampleComplete(files, docsOnly = ENV_DOCS_ONLY) {
  const ex = files.find((x) => x.path === '.env.example');
  if (!ex) return { status: 'FAIL', details: '.env.example missing' };
  const bad = [];
  const documented = new Map();
  const lines = ex.text.split('\n');
  lines.forEach((line, i) => {
    const m = /^\s*(?:#\s*)?([A-Z][A-Z0-9_]+)=/.exec(line);
    if (!m) return;
    const name = m[1];
    if (documented.has(name)) bad.push(`${name} listed twice (line ${i + 1})`);
    documented.set(name, i);
    const above = (lines[i - 1] ?? '').trim();
    if (!above.startsWith('#') || /^#\s*[A-Z][A-Z0-9_]+=/.test(above) || above.replace(/^#+\s*/, '') === '') {
      bad.push(`${name} has no comment line above it`);
    } else if (name in docsOnly && !/^#\s*docs-only:\s*\S/.test(above)) {
      bad.push(`${name} needs a "# docs-only: <reason>" comment`);
    }
  });
  const usage = scanEnvUsage(files);
  for (const [name, paths] of usage) {
    if (!documented.has(name)) bad.push(`${name} is read (${paths[0]}) but missing from .env.example`);
    if (name in docsOnly) bad.push(`${name} is read (${paths[0]}) but listed as docs-only`);
  }
  for (const name of documented.keys()) {
    if (!usage.has(name) && !(name in docsOnly)) bad.push(`${name} is in .env.example but no code reads it`);
  }
  for (const name of Object.keys(docsOnly)) {
    if (!documented.has(name)) bad.push(`${name} is a docs-only exception but missing from .env.example`);
  }
  return result(bad.slice(0, 1).concat(bad.length > 1 ? [`and ${bad.length - 1} more`] : []), `${documented.size} names match the code`);
}

export function checkNoLegacyIds(files) {
  return result(
    findMatches(files, (p) => isSelf(p) || under(p, 'docs/', 'legacy/'), [
      ['legacy GA id', /G-7QEZCZ09WY/],
      ['legacy GTM id', /GTM-5XB7XDT/],
    ]),
  );
}

export function checkNoDeadDeps(files) {
  const dead = ['react-scripts', 'react-ga4', 'gh-pages', 'react-router-dom'];
  const bad = [];
  for (const f of files) {
    const base = f.path.split('/').pop();
    if (base !== 'package.json' && base !== 'package-lock.json') continue;
    let json;
    try {
      json = JSON.parse(f.text);
    } catch {
      bad.push(`${f.path} (invalid JSON)`);
      continue;
    }
    // D-9: react-router-dom is approved for the admin workspace only.
    const manifests =
      base === 'package.json'
        ? [[f.path.replace(/package\.json$/, '').replace(/\/$/, ''), json]]
        : Object.entries(json.packages ?? {}).filter(([k]) => !k.includes('node_modules'));
    for (const [dir, m] of manifests) {
      for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        for (const d of dead) {
          if (d === 'react-router-dom' && dir === 'apps/admin') continue;
          if (m?.[field] && d in m[field]) bad.push(`${f.path} (${d})`);
        }
      }
    }
  }
  return result(bad);
}

export function checkNoDirectR2(files) {
  const allowed = ['packages/shared/src/storage/', 'apps/api/src/storage/'];
  return result(
    findMatches(
      files,
      (p) =>
        isSelf(p) ||
        p === 'scripts/architecture.golden.json' || // names the required Worker dependency, makes no R2 call
        isLockfile(p) ||
        p.endsWith('/package.json') ||
        under(p, 'docs/', 'legacy/', ...allowed),
      [
        ['aws4fetch', /aws4fetch/],
        ['r2 endpoint', /r2\.cloudflarestorage\.com/],
        ['R2Bucket', /R2Bucket/],
        ['@aws-sdk', /@aws-sdk/],
      ],
    ),
  );
}

export function checkNoGaInDist(distFiles) {
  const html = distFiles.filter((f) => /^apps\/[^/]+\/dist\/.*\.html$/.test(f.path));
  if (html.length === 0) return { status: 'SKIP', details: 'no dist html found' };
  return result(
    findMatches(html, () => false, [
      ['googletagmanager', /googletagmanager/i],
      ['google-analytics', /google-analytics/i],
      ['gtag(', /gtag\(/],
    ]),
    `${html.length} html files clean`,
  );
}

// ---------------------------------------------------------------------------------------------- analytics isolation (WP7-5)
// Cloudflare Web Analytics lives on the public site only, as one exact beacon tag. Everything else stays clean.
export const BEACON_SRC = 'https://static.cloudflareinsights.com/beacon.min.js';
export const ANALYTICS_RE = /cloudflareinsights|data-cf-beacon|beacon\.min\.js/i;

/** True for the one allowed tag: type=module, the beacon src, a data-cf-beacon holding only a token, no body. */
function isExactBeaconTag(attrString, body) {
  if (body.trim() !== '') return false;
  const a = attrsOf(`<script ${attrString}>`);
  if (Object.keys(a).sort().join() !== 'data-cf-beacon,src,type') return false;
  if (a.type !== 'module' || a.src !== BEACON_SRC) return false;
  try {
    const cfg = JSON.parse(a['data-cf-beacon']);
    return Object.keys(cfg).join() === 'token' && /^[A-Za-z0-9]{16,64}$/.test(cfg.token);
  } catch {
    return false;
  }
}

/** Removes exact beacon tags from html; returns the rest and how many were removed. */
export function stripBeaconTags(html) {
  let count = 0;
  const rest = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (all, attrs, body) => {
    if (!isExactBeaconTag(attrs, body)) return all;
    count += 1;
    return '';
  });
  return { rest, count };
}

/**
 * Built html: apps/web/dist may contain the beacon words only as one exact beacon tag per page; any other app's
 * dist html (the admin) may not contain them at all.
 */
export function checkAnalyticsInDist(distFiles) {
  const html = (distFiles ?? []).filter((f) => /^apps\/[^/]+\/dist\/.*\.html$/.test(f.path));
  if (html.length === 0) return { status: 'SKIP', details: 'no dist html found' };
  const bad = [];
  for (const f of html) {
    if (f.path.startsWith('apps/web/dist/')) {
      const { rest, count } = stripBeaconTags(f.text);
      if (ANALYTICS_RE.test(rest)) bad.push(`${f.path} (beacon text outside the one exact beacon tag)`);
      if (count > 1) bad.push(`${f.path} (${count} beacon tags)`);
    } else if (ANALYTICS_RE.test(f.text)) {
      bad.push(`${f.path} (analytics beacon outside the public site)`);
    }
  }
  return result(bad, `${html.length} html files, beacon only as the exact tag on the public site`);
}

/** Admin source and the Worker never mention the beacon (tests excluded: they may assert the absence). */
export function checkAnalyticsNotInAdminOrApi(files) {
  const src = files.filter(
    (f) => (f.path.startsWith('apps/admin/src/') || f.path.startsWith('apps/api/')) && !/\.test\.[cm]?[jt]sx?$/.test(f.path) && !f.path.endsWith('package-lock.json'),
  );
  return result(findMatches(src, () => false, [['analytics beacon', ANALYTICS_RE]]), `${src.length} admin and api sources clean`);
}


/**
 * Static migration lint: files are named <14 digits>_<name>.sql with strictly ascending timestamps,
 * no "to public" grant, no "using (true)" policy, no service role. The catalog lint itself
 * (supabase/tests/lint.test.ts, run by `npm test`) and its golden matrix must be present.
 */
export function checkMigrationsLint(files) {
  const bad = [];
  const sql = files.filter((f) => /^supabase\/migrations\//.test(f.path)).sort((a, b) => (a.path < b.path ? -1 : 1));
  if (sql.length === 0) return { status: 'FAIL', details: 'no migrations found in supabase/migrations' };
  let prev = '';
  for (const f of sql) {
    const m = MIGRATION_RE.exec(f.path);
    if (!m) {
      bad.push(`${f.path} (name must be <14 digits>_<name>.sql)`);
      continue;
    }
    if (m[1] <= prev) bad.push(`${f.path} (timestamp not strictly ascending)`);
    prev = m[1];
    const text = stripSqlComments(f.text);
    if (/\bto\s+public\b(?!\s*\.)/i.test(text)) bad.push(`${f.path} ("to public")`);
    if (/using\s*\(\s*true\s*\)/i.test(text) || /with\s+check\s*\(\s*true\s*\)/i.test(text)) bad.push(`${f.path} (policy true)`);
    if (/service_role/i.test(text)) bad.push(`${f.path} (service role)`);
  }
  for (const required of ['supabase/tests/lint.test.ts', 'supabase/tests/golden/privilege-matrix.json']) {
    if (!files.some((f) => f.path === required)) bad.push(`${required} missing`);
  }
  return result(bad, `${sql.length} migrations in order, text lint clean`);
}

export const QUOTA_GUARD_FILE = 'apps/api/test/quota-guard.test.ts';
export const QUOTA_GUARD_TITLES = [
  'refuses a reserve that would cross the hard limit and issues no URL',
  'accepts a reserve exactly at the limit',
  'accepts just under the limit',
  'level is warn from the warn threshold and full at the hard limit',
  'deleting photos lowers usage and re-allows an upload',
  'a direct call over the limit is refused with STORAGE_FULL',
  'limits come from app_config: lowering the limit changes the result',
  'commit is refused when the object is larger than reserved (presign did not enforce length)',
  'register backstop refuses over the limit even without a reservation',
  'partial batch: a refused big file does not block a later small one',
  'two parallel batches cannot both take the last bytes',
];

/** The T-6 acceptance suite must exist and contain every fixed case title as an it(...) title. */
export function checkQuotaGuardTests(files) {
  const f = files.find((x) => x.path === QUOTA_GUARD_FILE);
  if (!f) return { status: 'FAIL', details: `${QUOTA_GUARD_FILE} missing` };
  const missing = QUOTA_GUARD_TITLES.filter((t) => {
    const quoted = [`'${t.replace(/'/g, "\\'")}'`, `"${t}"`, `\`${t}\``];
    return !quoted.some((q) => new RegExp(`\\bit\\(\\s*${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(f.text));
  });
  return result(
    missing.map((t) => `missing case "${t}"`),
    `${QUOTA_GUARD_TITLES.length} cases present`,
  );
}

export const WRANGLER_TOML = 'apps/api/wrangler.toml';

/**
 * Worker hygiene (WP4-19): wrangler.toml has no `[vars]` section, no secret-named assignment and no
 * key-shaped value (32+ token characters); no console call in apps/api/src (tests excluded) mentions
 * authorization or a bearer token on the same line.
 */
export function checkApiHygiene(files) {
  const bad = [];
  const toml = files.find((x) => x.path === WRANGLER_TOML);
  if (!toml) bad.push(`${WRANGLER_TOML} missing`);
  else {
    const code = toml.text.replace(/^\s*#.*$/gm, '');
    if (/^\s*\[(vars|env\.[^\]]*\.vars)\]/m.test(code)) bad.push(`${WRANGLER_TOML} (has a [vars] section)`);
    if (/^\s*[A-Za-z0-9_]*(secret|token|password|api_?key|access_?key)[A-Za-z0-9_]*\s*=/im.test(code)) {
      bad.push(`${WRANGLER_TOML} (secret-named assignment)`);
    }
    if (/["'][A-Za-z0-9+/_=-]{32,}["']/.test(code)) bad.push(`${WRANGLER_TOML} (key-shaped value)`);
  }
  for (const f of files) {
    if (!f.path.startsWith('apps/api/src/') || /\.test\.ts$/.test(f.path)) continue;
    f.text.split('\n').forEach((line, i) => {
      if (/console\.\w+\s*\(/.test(line) && /authorization|bearer/i.test(line)) {
        bad.push(`${f.path}:${i + 1} (console call mentions authorization)`);
      }
    });
  }
  return result(bad);
}

// ---------------------------------------------------------------------------------------------- admin security (WP5-30)
// Source rules scan apps/admin/src (tests excluded). The admin runs in the photographer's browser with the anon key
// and her JWT only: no service key, no sign-up, no HTML injection, no direct writes to `photos` (the Worker does
// those), no R2 hosts (uploads use presigned URLs from the Worker), no hard-coded limits (they come from app_config).
// apps/admin/src/a11y/ is test support (axe audit helpers), never imported by the app.
const isAdminSrc = (p) =>
  p.startsWith('apps/admin/src/') && /\.(ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p) && !p.startsWith('apps/admin/src/a11y/');
const adminSource = (files) => files.filter((f) => isAdminSrc(f.path));
const adminRule = (patterns, passMsg) => (files) => {
  const src = adminSource(files);
  return result(findMatches(src, () => false, patterns), `${src.length} admin sources clean${passMsg ? `, ${passMsg}` : ''}`);
};
const Q = `['"\`]`;

export const checkAdminNoServiceKey = adminRule([
  ['service_role', /service[_-]?role/i],
  ['service key name', /service[_-]?key/i],
]);
export const checkAdminNoSignUp = adminRule([
  ['signUp', /\bsign_?up\s*\(/i],
  ['auth signup endpoint', /auth\/v1\/signup/i],
  ['admin user creation', /auth\.admin|createUser\s*\(/],
]);
export const checkAdminNoHtmlInjection = adminRule([
  ['dangerouslySetInnerHTML', /dangerouslySetInnerHTML/],
  ['innerHTML/outerHTML', /\b(inner|outer)HTML\b/],
  ['insertAdjacentHTML', /insertAdjacentHTML/],
  ['document.write', /document\.write(ln)?\s*\(/],
  ['eval / Function', /\beval\s*\(|new\s+Function\s*\(/],
]);
export const checkAdminNoPhotoWrites = adminRule([
  ['photos insert/delete via rest helper', new RegExp(`\\b(insert|remove|delete|upsert)\\s*(<[^>(]*>)?\\(\\s*${Q}photos${Q}`)],
  ['photos insert/delete via from()', new RegExp(`from\\(\\s*${Q}photos${Q}\\s*\\)\\s*\\.\\s*(insert|delete|upsert)`)],
  ['photos via REST path', /rest\/v1\/photos/],
]);
export const checkAdminNoR2Hosts = adminRule([
  ['r2.cloudflarestorage.com', /r2\.cloudflarestorage\.com/i],
  ['r2.dev', /\.r2\.dev\b/i],
  ['R2 SDK', /aws4fetch|@aws-sdk|R2Bucket/],
]);
export const checkAdminNoLimitLiterals = adminRule([
  ['hard quota 10 GB', /(?<![\d_.,])10[_,]?000[_,]?000[_,]?000(?![\d_])/],
  ['warn quota 8 GB', /(?<![\d_.,])8[_,]?000[_,]?000[_,]?000(?![\d_])/],
  ['max upload 12 MB', /(?<![\d_.,])12[_,]?000[_,]?000(?![\d_])/],
]);

// Dist rules scan the production builds of the admin that exist on disk (apps/admin/dist and the gitignored
// .tmp/admin-prod/site of admin-prod-check). The fake build in .tmp/admin-check is meant to contain the marker and
// is never scanned. No build on disk: SKIP (a build is not made here, the gate stays fast).
export const ADMIN_DIST_ROOTS = ['apps/admin/dist/', '.tmp/admin-prod/site/'];
export const FAKE_WORLD_MARKER = 'MP_ADMIN_FAKE_WORLD_7f3a9c';
const adminDistRule = (patterns) => (distFiles) => {
  const dist = (distFiles ?? []).filter((f) => ADMIN_DIST_ROOTS.some((r) => f.path.startsWith(r)));
  if (dist.length === 0) return { status: 'SKIP', details: 'no admin build on disk (npm run build -w apps/admin or npm run admin-prod-check)' };
  return result(findMatches(dist, () => false, patterns), `${dist.length} built files clean`);
};
export const checkAdminDistNoFakeMarker = adminDistRule([
  ['fake world marker', new RegExp(FAKE_WORLD_MARKER)],
  ['fake world marker name', /MP_ADMIN_FAKE_WORLD/],
]);
export const checkAdminDistNoAnalytics = adminDistRule([['analytics beacon', ANALYTICS_RE]]);
export const checkAdminDistNoKeyStrings = adminDistRule([
  ['JWT', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/],
  ['sk_ key', /\bsk_(live_|test_)?[A-Za-z0-9]{16,}/],
  ['AWS access key id', /\b(AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY/],
  ['service_role', /service_role/i],
  ['secret-named long value', /(secret|password|token)[\w"' ]{0,20}[:=]\s*["'][A-Za-z0-9+/_-]{32,}["']/i],
]);

// ---------------------------------------------------------------------------------------------- no password code (WP9-S10)
// The admin signs in with Google only. Our own code (apps/admin/src and scripts/, tests and the gate files excluded)
// may not call or build any password flow. The built bundle is scanned only for a password input field: the supabase-js
// vendor chunk legitimately contains `grant_type=password`, so that string is not looked for in dist.
export const PASSWORD_SOURCE_PATTERNS = [
  ['signInWithPassword', /signInWithPassword/],
  ['resetPasswordForEmail', /resetPasswordForEmail/],
  ['grant_type=password', /grant_type=password/],
  ['type="password"', /type\s*=\s*\{?\s*\\?["'`]password\\?["'`]/],
  ['autoComplete current-password', /autoComplete\s*=\s*\{?\s*["'`]current-password["'`]/i],
  ['updateUser({ password', /updateUser\s*\(\s*\{\s*password/],
];
export const PASSWORD_DIST_PATTERNS = [
  ['password input field', /\btype\s*[=:]\s*\\?["']password\\?["']/],
  ['current-password autocomplete', /current-password/],
];
const isPasswordScanned = (p) =>
  (p.startsWith('apps/admin/src/') || p.startsWith('scripts/')) &&
  /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(p) &&
  !/\.test\.[cm]?[jt]sx?$/.test(p) &&
  !/^scripts\/gates[^/]*\.mjs$/.test(p) &&
  !isSelf(p);
export function checkNoPasswordCode(files) {
  const src = files.filter((f) => isPasswordScanned(f.path));
  return result(findMatches(src, () => false, PASSWORD_SOURCE_PATTERNS), `${src.length} admin and script sources clean`);
}
export const checkAdminDistNoPassword = adminDistRule(PASSWORD_DIST_PATTERNS);

// Hosts that libraries only mention in comments, error messages or XML namespaces (not requested by the app).
export const LIBRARY_HOSTS = ['github.com', 'reactjs.org', 'reactrouter.com', 'json-schema.org', 'w3.org', 'localhost', '127.0.0.1'];
const hostOf = (v) => {
  try {
    return new URL(v).hostname;
  } catch {
    return null;
  }
};
export function checkAdminDistExternalHosts(distFiles, envHosts = envUrlHosts()) {
  const dist = (distFiles ?? []).filter((f) => ADMIN_DIST_ROOTS.some((r) => f.path.startsWith(r)));
  if (dist.length === 0) return { status: 'SKIP', details: 'no admin build on disk' };
  const allowed = [...LIBRARY_HOSTS, ...envHosts];
  const bad = new Set();
  for (const f of dist) {
    for (const m of f.text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
      const h = m[1].toLowerCase().replace(/\.$/, '');
      if (!allowed.some((a) => h === a || h.endsWith(`.${a}`))) bad.add(`${f.path} (${h})`);
    }
  }
  return result([...bad], `${dist.length} built files, hosts limited to libraries and env`);
}
/** Hosts of the VITE_*_URL / *_ORIGIN values in the environment (what a build may legitimately embed). */
export function envUrlHosts(env = process.env) {
  return Object.entries(env)
    .filter(([k, v]) => /^VITE_.*(URL|ORIGIN)$/.test(k) && v)
    .map(([, v]) => hostOf(v))
    .filter(Boolean);
}

// ---------------------------------------------------------------------------------------------- migration script (WP6-13)
// scripts/migrate-legacy.ts and scripts/migrate-legacy/** (tests excluded) run on the photographer's machine with the
// anon key and her JWT: no service key, no sign-up, no direct writes to `photos` (the Worker commit does those; the
// HttpBackend may PATCH albums, POST categories/albums and read photos), no R2/S3 hosts or SDKs (presigned PUTs only),
// and no committed credentials.
// Shared by the migrate source gates: a script entry file plus its directory, tests excluded.
const isScriptSrcOf = (entry, dir) => (p) =>
  (p === entry || p.startsWith(dir)) && /\.(ts|mjs|js)$/.test(p) && !/\.test\.(ts|mjs|js)$/.test(p);
const isMigrateSrc = isScriptSrcOf('scripts/migrate-legacy.ts', 'scripts/migrate-legacy/');
const sourceRule = (isSrc, label) => (patterns) => (files) => {
  const src = files.filter((f) => isSrc(f.path));
  return result(findMatches(src, () => false, patterns), `${src.length} ${label} sources clean`);
};
const migrateRule = sourceRule(isMigrateSrc, 'migrate-legacy');
const WRITE_METHOD = `['"\`](POST|PATCH|PUT|DELETE)['"\`]`;

const SERVICE_KEY_PATTERNS = [
  ['service_role', /service[_-]?role/i],
  ['service key name', /service[_-]?key/i],
];
const R2_PATTERNS = [
  ['r2.cloudflarestorage.com', /r2\.cloudflarestorage\.com/i],
  ['r2.dev', /\.r2\.dev\b/i],
  ['R2/S3 SDK', /@aws-sdk|aws4fetch|R2Bucket/],
];
const CREDENTIAL_PATTERNS = [
  ['JWT', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/],
  ['sk_ key', /\bsk_(live_|test_)?[A-Za-z0-9]{16,}/],
  ['AWS access key id', /\b(AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY/],
  ['key-named long value', /(key|secret|token|password)[\w"' ]{0,20}[:=]\s*["'][A-Za-z0-9+/_-]{32,}["']/i],
];

export const checkMigrateNoServiceKey = migrateRule(SERVICE_KEY_PATTERNS);
export const checkMigrateNoSignUp = migrateRule([
  ['signUp', /\bsign_?up\s*\(/i],
  ['auth signup endpoint', /auth\/v1\/signup/i],
  ['admin user creation', /auth\.admin|auth\/v1\/admin|createUser\s*\(/],
]);
export const checkMigrateNoPhotoWrites = migrateRule([
  ['photos write via rest helper', new RegExp(`\\brest\\s*(<[^>(]*>)?\\(\\s*${WRITE_METHOD}\\s*,\\s*${Q}photos${Q}`)],
  ['photos insert/delete via helper', new RegExp(`\\b(insert|remove|delete|upsert)\\s*(<[^>(]*>)?\\(\\s*${Q}photos${Q}`)],
  ['photos write via from()', new RegExp(`from\\(\\s*${Q}photos${Q}\\s*\\)\\s*\\.\\s*(insert|update|delete|upsert)`)],
  ['photos via REST path literal', /rest\/v1\/photos/],
]);
export const checkMigrateNoR2 = migrateRule(R2_PATTERNS);
export const checkMigrateNoCredentials = migrateRule(CREDENTIAL_PATTERNS);

// T-222 / D-17: there is no backup or restore tooling (scripts/backup*, scripts/restore-plan*), so no gates for it.

// ---------------------------------------------------------------------------------------------- architecture (WP8-3..5)
// The arch-* gate functions live in scripts/gates-arch.mjs; re-exported here so imports of gates.mjs keep working.
export {
  ARCH_GOLDEN,
  checkArchApiSurface,
  checkArchComponents,
  checkArchDataModel,
  checkArchHostingFiles,
  checkArchStorageKeys,
  checkArchTestsPresent,
} from './gates-arch.mjs';

// docs-complete lives in scripts/gates-docs.mjs; the registry passes its own name list in (checked lazily, no cycle).
export { checkDocsComplete, checkGatesRows } from './gates-docs.mjs';

export const CHECKS = [
  { name: 'no-secrets', input: 'files', run: checkNoSecrets },
  { name: 'no-service-role', input: 'files', run: checkNoServiceRole },
  { name: 'no-env-files', input: 'files', run: checkNoEnvFiles },
  { name: 'env-example-sane', input: 'files', run: (f) => checkEnvExampleSane(f) },
  { name: 'env-example-complete', input: 'files', run: (f) => checkEnvExampleComplete(f) },
  { name: 'no-legacy-ids', input: 'files', run: checkNoLegacyIds },
  { name: 'no-dead-deps', input: 'files', run: checkNoDeadDeps },
  { name: 'no-direct-r2', input: 'files', run: checkNoDirectR2 },
  { name: 'no-ga-in-dist', input: 'dist', run: checkNoGaInDist },
  { name: 'analytics-in-dist', input: 'dist', run: checkAnalyticsInDist },
  { name: 'analytics-not-admin', input: 'files', run: checkAnalyticsNotInAdminOrApi },
  { name: 'migrations-lint', input: 'files', run: checkMigrationsLint },
  { name: 'page-checks', input: 'site', run: checkPageChecks },
  { name: 'budget', input: 'site', run: checkBudget },
  { name: 'quota-guard-tests', input: 'files', run: checkQuotaGuardTests },
  { name: 'api-hygiene', input: 'files', run: checkApiHygiene },
  { name: 'admin-no-service-key', input: 'files', run: checkAdminNoServiceKey },
  { name: 'admin-no-signup', input: 'files', run: checkAdminNoSignUp },
  { name: 'admin-no-html-inject', input: 'files', run: checkAdminNoHtmlInjection },
  { name: 'admin-no-photo-writes', input: 'files', run: checkAdminNoPhotoWrites },
  { name: 'admin-no-r2-hosts', input: 'files', run: checkAdminNoR2Hosts },
  { name: 'admin-no-limit-literals', input: 'files', run: checkAdminNoLimitLiterals },
  { name: 'admin-dist-no-fake', input: 'admindist', run: checkAdminDistNoFakeMarker },
  { name: 'admin-dist-no-keys', input: 'admindist', run: checkAdminDistNoKeyStrings },
  { name: 'admin-dist-no-analytics', input: 'admindist', run: checkAdminDistNoAnalytics },
  { name: 'admin-dist-hosts', input: 'admindist', run: (d) => checkAdminDistExternalHosts(d) },
  { name: 'no-password-code', input: 'files', run: checkNoPasswordCode },
  { name: 'admin-dist-no-password', input: 'admindist', run: checkAdminDistNoPassword },
  { name: 'migrate-no-service-key', input: 'files', run: checkMigrateNoServiceKey },
  { name: 'migrate-no-signup', input: 'files', run: checkMigrateNoSignUp },
  { name: 'migrate-no-photo-writes', input: 'files', run: checkMigrateNoPhotoWrites },
  { name: 'migrate-no-r2', input: 'files', run: checkMigrateNoR2 },
  { name: 'migrate-no-credentials', input: 'files', run: checkMigrateNoCredentials },
  { name: 'arch-components', input: 'files', run: (f) => checkArchComponents(f) },
  { name: 'arch-data-model', input: 'files', run: (f) => checkArchDataModel(f) },
  { name: 'arch-api-surface', input: 'files', run: (f) => checkArchApiSurface(f) },
  { name: 'arch-storage-keys', input: 'files', run: (f) => checkArchStorageKeys(f) },
  { name: 'arch-hosting-files', input: 'files', run: (f) => checkArchHostingFiles(f) },
  { name: 'arch-tests-present', input: 'files', run: (f) => checkArchTestsPresent(f) },
  { name: 'docs-complete', input: 'files', run: (f) => checkDocsComplete(f, CHECKS.map((c) => c.name)) },
];

export function runChecks(inputs, { strict = false, checks = CHECKS } = {}) {
  const rows = checks.map((c) => ({
    name: c.name,
    ...c.run(
      c.input === 'dist'
        ? inputs.dist
        : c.input === 'admindist'
          ? (inputs.admindist ?? [])
          : c.input === 'site'
            ? (inputs.site ?? null)
            : inputs.files,
    ),
  }));
  const failed = rows.some((r) => r.status === 'FAIL' || (strict && r.status === 'PENDING'));
  return { rows, exitCode: failed ? 1 : 0 };
}

const SKIP_EXT = /\.(jpe?g|png|webp|avif|gif|ico|woff2?|pdf|zip|tgz)$/i;

function readText(root, p) {
  try {
    const full = join(root, p);
    if (SKIP_EXT.test(p) || statSync(full).size > 2_000_000) return null;
    return readFileSync(full, 'utf8');
  } catch {
    return null;
  }
}

export function loadFiles(root, paths) {
  const out = [];
  for (const p of paths) {
    const text = readText(root, p);
    if (text !== null) out.push({ path: p, text });
  }
  return out;
}

export function gitPaths(root) {
  const out = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split('\n').filter(Boolean);
}

export function walk(dir, base = dir) {
  const out = [];
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full, base));
    else out.push(relative(base, full).split(sep).join('/'));
  }
  return out;
}

export function collect(root) {
  const files = loadFiles(root, gitPaths(root));
  const distPaths = [];
  for (const app of walk(join(root, 'apps'), root).filter((p) => /\/dist\/.*\.html$/.test(p))) {
    distPaths.push(app);
  }
  const admindist = [];
  for (const r of ADMIN_DIST_ROOTS) {
    const base = join(root, r);
    admindist.push(...loadFiles(root, walk(base).filter((p) => /\.(js|css|html)$/.test(p)).map((p) => r + p)));
  }
  return { files, dist: loadFiles(root, distPaths), admindist, site: loadSite(join(root, 'apps', 'web', 'dist')) };
}

export function main(argv = process.argv.slice(2)) {
  const strict = argv.includes('--strict');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const { rows, exitCode } = runChecks(collect(root), { strict });
  for (const r of rows) console.log(`${r.status.padEnd(7)} ${r.name.padEnd(20)} ${r.details}`);
  const pend = rows.filter((r) => r.status === 'PENDING').map((r) => r.name);
  if (strict && pend.length) console.log(`STRICT: pending counts as FAIL: ${pend.join(', ')}`);
  console.log(exitCode === 0 ? 'GATES OK' : 'GATES FAILED');
  return exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
