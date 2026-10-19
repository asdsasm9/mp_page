// Gate registry. Each check is a pure function (files) => {status, details}.
// files: {path, text}[] with repo-relative posix paths.
// Statuses: PASS | FAIL | PENDING | SKIP. `--strict` makes PENDING count as FAIL.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SELF = ['scripts/gates.mjs', 'scripts/gates.test.mjs'];
const isSelf = (p) => SELF.includes(p);
const under = (p, ...prefixes) => prefixes.some((x) => p.startsWith(x));
const isLockfile = (p) => p.endsWith('package-lock.json');

const result = (offenders, passMsg = 'ok') =>
  offenders.length ? { status: 'FAIL', details: offenders.join('; ') } : { status: 'PASS', details: passMsg };

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
  const patterns = [
    ['private key block', /-----BEGIN [A-Z ]*(PRIVATE KEY|CERTIFICATE)?/],
    ['sk_ key', /\bsk_(live_|test_)?[A-Za-z0-9]{16,}/],
    ['JWT', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/],
    [
      'long key-like value',
      /(key|secret|token|password)[\w"' ]{0,20}[:=]\s*["']?[A-Za-z0-9+/_-]{32,}/i,
    ],
  ];
  return result(
    findMatches(files, (p) => isSelf(p) || isLockfile(p) || under(p, 'legacy/', 'docs/'), patterns),
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
    const manifests =
      base === 'package.json'
        ? [json]
        : Object.entries(json.packages ?? {})
            .filter(([k]) => !k.includes('node_modules'))
            .map(([, v]) => v);
    for (const m of manifests) {
      for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        for (const d of dead) if (m?.[field] && d in m[field]) bad.push(`${f.path} (${d})`);
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

const MIGRATION_RE = /^supabase\/migrations\/(\d{14})_[a-z0-9_]+\.sql$/;
const stripSqlComments = (sql) => sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');

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

const pending = (owner) => () => ({ status: 'PENDING', details: `owned by ${owner}` });

export const CHECKS = [
  { name: 'no-secrets', input: 'files', run: checkNoSecrets },
  { name: 'no-service-role', input: 'files', run: checkNoServiceRole },
  { name: 'no-env-files', input: 'files', run: checkNoEnvFiles },
  { name: 'env-example-sane', input: 'files', run: (f) => checkEnvExampleSane(f) },
  { name: 'no-legacy-ids', input: 'files', run: checkNoLegacyIds },
  { name: 'no-dead-deps', input: 'files', run: checkNoDeadDeps },
  { name: 'no-direct-r2', input: 'files', run: checkNoDirectR2 },
  { name: 'no-ga-in-dist', input: 'dist', run: checkNoGaInDist },
  { name: 'migrations-lint', input: 'files', run: checkMigrationsLint },
  { name: 'page-checks', input: 'files', run: pending('WP-3') },
  { name: 'budget', input: 'files', run: pending('WP-3') },
  { name: 'quota-guard-tests', input: 'files', run: pending('WP-4') },
  { name: 'docs-complete', input: 'files', run: pending('WP-8') },
];

export function runChecks(inputs, { strict = false, checks = CHECKS } = {}) {
  const rows = checks.map((c) => ({
    name: c.name,
    ...c.run(c.input === 'dist' ? inputs.dist : inputs.files),
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
  return { files, dist: loadFiles(root, distPaths) };
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
