// Architecture-conformance gates (WP-8). Pure functions (files, golden?) => {status, details} over
// scripts/architecture.golden.json. Re-exported by scripts/gates.mjs, which registers them in CHECKS.
import {
  ARCH_GOLDEN,
  MIGRATION_RE,
  firstOffenders,
  globToRegExp,
  loadGolden,
  result,
  stripCodeComments,
  stripSqlComments,
} from './lib/gate-utils.mjs';

export { ARCH_GOLDEN };

const EXACT_VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

/**
 * Component layout against scripts/architecture.golden.json (MASTERPLAN section 3, D-2): the workspace directories
 * exist, the root workspaces are exactly the golden globs, each workspace declares its required dependencies, no
 * SSR adapter dependency anywhere, the Astro config is not server/hybrid output, and the pinned packages use an
 * exact version (no ^ or ~). Static text checks: they catch drift, behaviour stays in the test suites.
 */
export function checkArchComponents(files, golden) {
  if (!golden) {
    const g = loadGolden(files);
    if (g.fail) return g.fail;
    golden = g.golden;
  }
  const c = golden.components ?? {};
  const bad = [];
  const manifests = new Map();
  const parse = (path) => {
    const f = files.find((x) => x.path === path);
    if (!f) return (bad.push(`${path} missing`), null);
    try {
      return JSON.parse(f.text);
    } catch {
      return (bad.push(`${path} is not valid JSON`), null);
    }
  };
  for (const dir of c.directories ?? []) {
    if (!files.some((x) => x.path.startsWith(`${dir}/`))) bad.push(`workspace ${dir} missing`);
  }
  const root = parse('package.json');
  if (root && JSON.stringify(root.workspaces ?? null) !== JSON.stringify(c.rootWorkspaces)) {
    bad.push(`root workspaces are not ${JSON.stringify(c.rootWorkspaces)}`);
  }
  if (root) manifests.set('package.json', root);
  const deps = (m) => ({ ...m?.optionalDependencies, ...m?.peerDependencies, ...m?.devDependencies, ...m?.dependencies });
  for (const [dir, required] of Object.entries(c.requiredDeps ?? {})) {
    const m = parse(`${dir}/package.json`);
    if (!m) continue;
    manifests.set(`${dir}/package.json`, m);
    for (const d of required) if (!(d in deps(m))) bad.push(`${dir} lacks dependency ${d}`);
  }
  for (const [path, m] of manifests) {
    for (const d of c.forbiddenDeps ?? []) if (d in deps(m)) bad.push(`${path} depends on ${d} (static site, no SSR adapter)`);
    for (const d of c.pinnedExactly ?? []) {
      const v = deps(m)[d];
      if (v !== undefined && !EXACT_VERSION.test(v)) bad.push(`${path} pins ${d} as "${v}" (exact version required)`);
    }
  }
  for (const cfg of files.filter((x) => /^apps\/web\/astro\.config\.[cm]?[jt]s$/.test(x.path))) {
    const code = cfg.text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
    const m = /\boutput\s*:\s*['"`](\w+)['"`]/.exec(code);
    if (m && (c.forbiddenAstroOutputs ?? []).includes(m[1])) bad.push(`${cfg.path} sets output '${m[1]}' (must be static)`);
    if (/\badapter\s*:/.test(code)) bad.push(`${cfg.path} sets an adapter (must be static)`);
  }
  return result(firstOffenders(bad), 'workspaces, deps, static astro as in the golden file');
}

// ------------------------------------------------------------------------------------------ data model (WP8-4)
const roleList = (s) => s.split(',').map((x) => x.trim().replace(/^public\./, '').replace(/"/g, '')).filter(Boolean);
const NOT_A_TABLE = /^(function|schema|sequence|all|type|database)\b/;

/** All migration statements in order: comments and dollar-quoted bodies removed, lower case, one line each. */
function migrationStatements(files) {
  const sql = files.filter((f) => MIGRATION_RE.test(f.path)).sort((a, b) => (a.path < b.path ? -1 : 1));
  return sql
    .map((f) => stripSqlComments(f.text))
    .join(';\n')
    .replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, () => '$$')
    .split(';')
    .map((s) => s.replace(/\s+/g, ' ').trim().toLowerCase())
    .filter(Boolean);
}

/** Splits a create-table body at top-level commas into column items. */
function topLevelItems(body) {
  const items = [];
  let depth = 0;
  let cur = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) (items.push(cur.trim()), (cur = ''));
    else cur += ch;
  }
  if (cur.trim()) items.push(cur.trim());
  return items;
}

/**
 * Database layout against the dataModel section of scripts/architecture.golden.json (MASTERPLAN section 3, D-5):
 * exact table set, row level security and an initial revoke from anon/authenticated on every table, no table grant
 * to anon, no insert/delete on photos for authenticated (only register_photo/delete_photos), the MASTERPLAN columns,
 * the app_config defaults, function privileges, and the behavioural suites that prove it. Static text checks over the
 * migrations: they catch drift, the PGlite suites remain the proof of behaviour.
 */
export function checkArchDataModel(files, golden) {
  if (!golden) {
    const g = loadGolden(files);
    if (g.fail) return g.fail;
    golden = g.golden;
  }
  const dm = golden.dataModel;
  if (!dm) return { status: 'FAIL', details: `${ARCH_GOLDEN} has no dataModel section` };
  const stmts = migrationStatements(files);
  if (stmts.length === 0) return { status: 'FAIL', details: 'no migrations found in supabase/migrations' };
  const bad = [];
  const tables = new Map();
  const funcs = new Map();
  const fn = (n) => funcs.get(n) ?? funcs.set(n, { created: false, definer: false, revoked: new Set(), granted: new Set() }).get(n);
  const anonOk = new Set(dm.anonExecute ?? []);
  stmts.forEach((s, i) => {
    let m;
    if ((m = /^create table (?:if not exists )?(?:public\.)?"?(\w+)"?/.exec(s))) {
      const t = { columns: new Set(), defaults: {}, rls: false, revokeAt: -1, grantAt: -1 };
      const open = s.indexOf('(');
      const close = s.lastIndexOf(')');
      for (const item of open >= 0 ? topLevelItems(s.slice(open + 1, close)) : []) {
        if (/^(constraint|primary|unique|check|foreign|exclude|like)\b/.test(item)) continue;
        const c = /^"?(\w+)"?/.exec(item)[1];
        t.columns.add(c);
        const d = /\bdefault (-?\d+)\b/.exec(item);
        if (d) t.defaults[c] = Number(d[1]);
      }
      tables.set(m[1], t);
    } else if ((m = /^drop table (?:if exists )?(?:public\.)?"?(\w+)"?/.exec(s))) {
      tables.delete(m[1]);
    } else if ((m = /^alter table (?:only )?(?:public\.)?"?(\w+)"? enable row level security$/.exec(s))) {
      if (tables.has(m[1])) tables.get(m[1]).rls = true;
    } else if ((m = /^alter table (?:only )?(?:public\.)?"?(\w+)"? add column (?:if not exists )?"?(\w+)"?(.*)$/.exec(s))) {
      const t = tables.get(m[1]);
      if (t) {
        t.columns.add(m[2]);
        const d = /\bdefault (-?\d+)\b/.exec(m[3]);
        if (d) t.defaults[m[2]] = Number(d[1]);
      }
    } else if ((m = /^alter table (?:only )?(?:public\.)?"?(\w+)"? alter column "?(\w+)"? set default (-?\d+)$/.exec(s))) {
      if (tables.has(m[1])) tables.get(m[1]).defaults[m[2]] = Number(m[3]);
    } else if ((m = /^revoke (?:all|execute)(?: privileges)? on function (?:public\.)?(\w+)\(.*?\) from (.+)$/.exec(s))) {
      for (const r of roleList(m[2])) fn(m[1]).revoked.add(r);
    } else if ((m = /^grant (?:all|execute)(?: privileges)? on function (?:public\.)?(\w+)\(.*?\) to (.+)$/.exec(s))) {
      const roles = roleList(m[2].replace(/ with grant option$/, ''));
      for (const r of roles) fn(m[1]).granted.add(r);
      if (roles.includes('anon') && !anonOk.has(m[1])) bad.push(`function ${m[1]} is executable by anon`);
    } else if ((m = /^create (?:or replace )?function (?:public\.)?"?(\w+)"?\(/.exec(s))) {
      const f = fn(m[1]);
      f.created = true;
      f.definer = /\bsecurity definer\b/.test(s);
    } else if ((m = /^revoke all(?: privileges)? on (?:table )?(.+) from (.+)$/.exec(s)) && !NOT_A_TABLE.test(m[1])) {
      const roles = roleList(m[2]);
      if (roles.includes('anon') && roles.includes('authenticated')) {
        for (const n of roleList(m[1])) if (tables.has(n) && tables.get(n).revokeAt < 0) tables.get(n).revokeAt = i;
      }
    } else if ((m = /^grant (.+?) on (?:table )?(.+) to (.+)$/.exec(s)) && !NOT_A_TABLE.test(m[2])) {
      const roles = roleList(m[3].replace(/ with grant option$/, ''));
      for (const n of roleList(m[2])) {
        const t = tables.get(n);
        if (t && t.grantAt < 0) t.grantAt = i;
        if (roles.includes('anon')) bad.push(`table ${n} is granted to anon`);
        if (n === 'photos' && roles.includes('authenticated') && /\b(insert|delete|all)\b/.test(m[1])) {
          bad.push(`table photos: authenticated may ${/\bdelete\b/.test(m[1]) ? 'delete' : 'insert'} directly (use ${dm.photoWriteFunctions.join('/')})`);
        }
      }
    } else if ((m = /^create policy \S+ on (?:public\.)?"?(\w+)"? (?:as \w+ )?for (insert|delete|all)\b/.exec(s))) {
      if (m[1] === 'photos') bad.push(`table photos has a ${m[2]} policy (writes go through ${dm.photoWriteFunctions.join('/')})`);
    } else if (/^alter default privileges .*\bgrant\b.*\bto\b.*\banon\b/.test(s)) {
      bad.push('default privileges grant to anon');
    }
  });

  const golden_ = new Set(dm.tables);
  for (const n of tables.keys()) if (!golden_.has(n)) bad.push(`table ${n} is not in the golden set`);
  for (const n of golden_) {
    const t = tables.get(n);
    if (!t) {
      bad.push(`table ${n} missing`);
      continue;
    }
    if (!t.rls) bad.push(`table ${n} has no row level security`);
    if (t.revokeAt < 0) bad.push(`table ${n} has no initial revoke from anon, authenticated`);
    else if (t.grantAt >= 0 && t.grantAt < t.revokeAt) bad.push(`table ${n} is granted before its revoke`);
    for (const c of dm.columns?.[n] ?? []) if (!t.columns.has(c)) bad.push(`table ${n} lacks column ${c}`);
  }
  const cfg = tables.get('app_config');
  if (cfg) {
    for (const [c, v] of Object.entries(dm.appConfigDefaults ?? {})) {
      if (cfg.defaults[c] !== v) bad.push(`table app_config default ${c} is ${cfg.defaults[c] ?? 'unset'}, golden ${v}`);
    }
  }
  for (const [name, want] of Object.entries(dm.functions ?? {})) {
    const f = funcs.get(name);
    if (!f?.created) {
      bad.push(`function ${name} missing`);
      continue;
    }
    for (const r of want.revokeFrom) if (!f.revoked.has(r)) bad.push(`function ${name} is not revoked from ${r}`);
    for (const r of f.granted) if (!want.grantTo.includes(r)) bad.push(`function ${name} is granted to ${r}`);
    for (const r of want.grantTo) if (!f.granted.has(r)) bad.push(`function ${name} is not granted to ${r}`);
    if ((dm.photoWriteFunctions ?? []).includes(name) && !f.definer) bad.push(`function ${name} is not security definer`);
  }
  for (const [name, f] of funcs) if (f.created && !(name in (dm.functions ?? {}))) bad.push(`function ${name} is not in the golden set`);
  for (const p of dm.requiredFiles ?? []) if (!files.some((x) => x.path === p)) bad.push(`${p} missing`);
  return result(firstOffenders(bad), `${tables.size} tables, ${funcs.size} functions as in the golden file`);
}

// ------------------------------------------------------------------------------------------ api surface (WP8-5)
const API_ROUTES_FILE = 'apps/api/src/default-routes.ts';
const API_INDEX_FILE = 'apps/api/src/index.ts';
const API_ENV_FILE = 'apps/api/src/env.ts';
const API_WRANGLER_FILE = 'apps/api/wrangler.toml';
const API_DOC_FILE = 'docs/API.md';
const stripTsComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
const listDiff = (what, found, want, bad) => {
  for (const x of found) if (!want.includes(x)) bad.push(`${what} ${x} is not in the golden file`);
  for (const x of want) if (!found.includes(x)) bad.push(`${what} ${x} missing`);
};

/**
 * Worker surface against the `api` section of scripts/architecture.golden.json (MASTERPLAN section 3): the route table
 * (DEFAULT_ROUTES keys plus the /health route in index.ts) equals the golden list; wrangler.toml declares exactly the
 * golden R2 bindings, exactly the golden number of crons, no [vars] values and no routes; env.ts reads exactly the
 * golden secret and plain-variable names (so a new secret must be added to the golden file first); docs/API.md has a
 * heading naming every route. Static text checks: behaviour stays in the apps/api tests.
 */
export function checkArchApiSurface(files, golden) {
  if (!golden) {
    const g = loadGolden(files);
    if (g.fail) return g.fail;
    golden = g.golden;
  }
  const api = golden.api;
  if (!api) return { status: 'FAIL', details: `${ARCH_GOLDEN} has no api section` };
  const text = (p) => files.find((x) => x.path === p)?.text;
  const bad = [];

  // Routes.
  const routesSrc = text(API_ROUTES_FILE);
  const indexSrc = text(API_INDEX_FILE);
  const routes = [];
  if (routesSrc === undefined) bad.push(`${API_ROUTES_FILE} missing`);
  else {
    const body = /DEFAULT_ROUTES[\s\S]*?=\s*\{([\s\S]*?)\n\}/.exec(stripTsComments(routesSrc));
    if (!body) bad.push(`${API_ROUTES_FILE} has no DEFAULT_ROUTES table`);
    else for (const m of body[1].matchAll(/^\s*['"`](\/[^'"`]*)['"`]\s*:/gm)) routes.push(m[1]);
  }
  if (indexSrc === undefined) bad.push(`${API_INDEX_FILE} missing`);
  else {
    const h = [...stripTsComments(indexSrc).matchAll(/pathname\s*===\s*['"`](\/[^'"`]*)['"`]/g)].map((m) => m[1]);
    if (h.length === 0) bad.push(`${API_INDEX_FILE} has no pathname route`);
    routes.push(...h);
  }
  if (routesSrc !== undefined && indexSrc !== undefined) listDiff('route', routes, api.routes ?? [], bad);

  // wrangler.toml.
  const toml = text(API_WRANGLER_FILE);
  if (toml === undefined) bad.push(`${API_WRANGLER_FILE} missing`);
  else {
    const code = toml.replace(/^\s*#.*$/gm, '').replace(/\s#[^"'\n]*$/gm, '');
    const bindings = [];
    let section = '';
    let crons = 0;
    for (const line of code.split('\n')) {
      const t = line.trim();
      const sec = /^\[\[?\s*([^\]]+?)\s*\]\]?$/.exec(t);
      if (sec) {
        section = sec[1];
        if (section !== 'r2_buckets' && t.startsWith('[[')) bad.push(`${API_WRANGLER_FILE} declares [[${section}]] (only the golden bindings are allowed)`);
        if (/^routes?$/.test(section)) bad.push(`${API_WRANGLER_FILE} declares routes`);
        if (/(^|\.)vars$/.test(section)) section = 'vars';
        continue;
      }
      if (t === '') continue;
      const kv = /^([A-Za-z0-9_.-]+)\s*=\s*(.*)$/.exec(t);
      if (!kv) continue;
      if (section === 'vars') bad.push(`${API_WRANGLER_FILE} [vars] sets ${kv[1]} (no vars with values)`);
      else if (section === 'r2_buckets' && kv[1] === 'binding') bindings.push(/["']([^"']+)["']/.exec(kv[2])?.[1] ?? '');
      else if (section === 'triggers' && kv[1] === 'crons') crons += [...kv[2].matchAll(/["'][^"']*["']/g)].length;
      else if (section === '' && /^(routes?|vars|kv_namespaces|d1_databases|durable_objects|services|queues)$/.test(kv[1])) {
        bad.push(`${API_WRANGLER_FILE} sets top-level ${kv[1]}`);
      }
    }
    listDiff('R2 binding', bindings, api.bindings ?? [], bad);
    if (crons !== api.cronCount) bad.push(`${API_WRANGLER_FILE} has ${crons} cron schedule(s), golden ${api.cronCount}`);
  }

  // Worker environment names.
  const envSrc = text(API_ENV_FILE);
  if (envSrc === undefined) bad.push(`${API_ENV_FILE} missing`);
  else {
    const names = [...stripTsComments(envSrc).matchAll(/\breq\(\s*['"`]([A-Z][A-Z0-9_]*)['"`]/g)].map((m) => m[1]);
    const secrets = api.secrets ?? [];
    const plain = api.plainVars ?? [];
    for (const n of names) {
      if (!secrets.includes(n) && !plain.includes(n)) bad.push(`env.ts reads ${n}, which is neither a golden secret nor a golden plain variable`);
    }
    for (const n of [...secrets, ...plain]) if (!names.includes(n)) bad.push(`env.ts no longer reads golden name ${n}`);
    if (secrets.some((n) => plain.includes(n))) bad.push('golden api: a name is both secret and plain variable');
  }

  // docs/API.md heading per route.
  const doc = text(API_DOC_FILE);
  if (doc === undefined) bad.push(`${API_DOC_FILE} missing`);
  else {
    const headings = doc
      .split('\n')
      .filter((l) => /^#{1,6}\s/.test(l))
      .map((l) => l.replace(/^#+\s*/, '').split(/\s+/));
    for (const r of api.routes ?? []) if (!headings.some((h) => h.includes(r))) bad.push(`${API_DOC_FILE} has no heading for ${r}`);
  }
  return result(firstOffenders(bad), `${routes.length} routes, bindings, cron, secrets and docs as in the golden file`);
}

// ------------------------------------------------------------------------------------------ storage keys (WP8-6)
const goldenSection = (files, golden, name) => {
  if (!golden) {
    const g = loadGolden(files);
    if (g.fail) return { fail: g.fail };
    golden = g.golden;
  }
  const s = golden[name];
  return s ? { section: s } : { fail: { status: 'FAIL', details: `${ARCH_GOLDEN} has no ${name} section` } };
};

/**
 * Storage key templates against the `storageKeys` section of the golden file (MASTERPLAN section 3): each golden
 * snippet (the SNAPSHOT_KEY constant and the master/webp/1600.jpg/og/backup templates) is still present in
 * packages/shared/src/keys.ts, the webp tier list in variants.ts equals the golden tiers, and keys.test.ts exists.
 * Static text check; keys.test.ts is the proof of behaviour.
 */
export function checkArchStorageKeys(files, golden) {
  const s = goldenSection(files, golden, 'storageKeys');
  if (s.fail) return s.fail;
  const k = s.section;
  const text = (p) => files.find((x) => x.path === p)?.text;
  const bad = [];
  const src = text(k.file);
  if (src === undefined) bad.push(`${k.file} missing`);
  else {
    const code = stripCodeComments(src);
    for (const snippet of k.snippets ?? []) if (!code.includes(snippet)) bad.push(`${k.file} lost key template ${snippet}`);
  }
  const variants = text(k.tiersFile);
  if (variants === undefined) bad.push(`${k.tiersFile} missing`);
  else {
    const m = /WEBP_TIER_VALUES\s*=\s*\[([^\]]*)\]/.exec(stripCodeComments(variants));
    const tiers = m ? m[1].split(',').map((x) => x.trim()).filter(Boolean).map(Number) : null;
    if (!tiers) bad.push(`${k.tiersFile} has no WEBP_TIER_VALUES list`);
    else if (JSON.stringify(tiers) !== JSON.stringify(k.webpTiers)) bad.push(`webp tiers are [${tiers}], golden [${k.webpTiers}]`);
  }
  if (!files.some((x) => x.path === k.testFile)) bad.push(`${k.testFile} missing`);
  return result(firstOffenders(bad), `${(k.snippets ?? []).length} key templates, ${(k.webpTiers ?? []).length} webp tiers and keys.test.ts as in the golden file`);
}

// ------------------------------------------------------------------------------------------ hosting files (WP8-6)
/**
 * Hosting files against the `hosting` section of the golden file (MASTERPLAN sections 3 and 7): the web generators
 * for _headers, _redirects and /_publish.json exist with their tests and are all written by the postbuild script;
 * the admin has a CSP/noindex headers builder, an SPA fallback and an index.html with noindex; no github.io,
 * gh-pages or Google tag reference in the hosted sources. Presence checks only: dist-level checks (no-ga-in-dist,
 * page-checks) and the generator tests remain the proof.
 */
export function checkArchHostingFiles(files, golden) {
  const s = goldenSection(files, golden, 'hosting');
  if (s.fail) return s.fail;
  const h = s.section;
  const text = (p) => files.find((x) => x.path === p)?.text;
  const bad = [];
  const needs = (path, what, snippets) => {
    const t = text(path);
    if (t === undefined) return bad.push(`${what}: ${path} missing`);
    const code = path.endsWith('.html') || path.includes('/_redirects') ? t : stripCodeComments(t);
    for (const sn of snippets ?? []) if (!code.includes(sn)) bad.push(`${what}: ${path} lacks ${sn}`);
  };
  for (const g of h.web?.generators ?? []) {
    needs(g.path, g.name, g.contains);
    if (!files.some((x) => x.path === g.test)) bad.push(`${g.name}: test ${g.test} missing`);
  }
  if (h.web?.postbuild) needs(h.web.postbuild.path, 'web postbuild', h.web.postbuild.contains);
  const a = h.admin;
  if (a) {
    needs(a.headers.path, 'admin headers', a.headers.contains);
    if (!files.some((x) => x.path === a.headers.test)) bad.push(`admin headers: test ${a.headers.test} missing`);
    const fb = text(a.spaFallback.path);
    if (fb === undefined) bad.push(`admin SPA fallback: ${a.spaFallback.path} missing`);
    else if (!new RegExp(a.spaFallback.pattern, 'm').test(fb)) bad.push(`admin SPA fallback: ${a.spaFallback.path} has no /* -> /index.html 200 rule`);
    const html = text(a.indexHtml.path);
    if (html === undefined) bad.push(`admin index.html: ${a.indexHtml.path} missing`);
    else if (!new RegExp(a.indexHtml.pattern, 'i').test(html)) bad.push(`admin index.html: ${a.indexHtml.path} has no noindex robots meta`);
  }
  const scope = (h.forbiddenRefs?.scope ?? []).map(globToRegExp);
  const refs = (h.forbiddenRefs?.patterns ?? []).map((p) => [p, new RegExp(p, 'i')]);
  for (const f of files) {
    if (!scope.some((re) => re.test(f.path))) continue;
    for (const [p, re] of refs) if (re.test(f.text)) bad.push(`${f.path} references ${p}`);
  }
  return result(firstOffenders(bad), 'web generators, admin headers/fallback/noindex and clean hosted sources as in the golden file');
}

// ------------------------------------------------------------------------------------------ required test suites (WP8-6)
/**
 * Required test suites against the `requiredSuites` list of the golden file (MASTERPLAN section 7): each entry
 * (adapter contract, variantPlan, snapshot schema, slug/alt rules, redirects, migration, RLS/grants, admin components)
 * must match at least one real file by glob, and when it has `mustMention` regexes, at least one matching file must
 * contain each of them (so the 13 albums / 141 photos / rerun expectations stay asserted somewhere).
 */
export function checkArchTestsPresent(files, golden) {
  const s = goldenSection(files, golden, 'requiredSuites');
  if (s.fail) return s.fail;
  const list = Array.isArray(s.section) ? s.section : [];
  if (list.length === 0) return { status: 'FAIL', details: `${ARCH_GOLDEN} requiredSuites is empty` };
  const bad = [];
  for (const suite of list) {
    const res = (suite.globs ?? []).map(globToRegExp);
    const hits = files.filter((x) => res.some((re) => re.test(x.path)));
    if (hits.length === 0) {
      bad.push(`suite "${suite.name}": no file matches ${(suite.globs ?? []).join(', ')}`);
      continue;
    }
    for (const pat of suite.mustMention ?? []) {
      const re = new RegExp(pat);
      if (!hits.some((x) => re.test(x.text))) bad.push(`suite "${suite.name}": no matching test mentions ${pat}`);
    }
  }
  return result(firstOffenders(bad), `${list.length} required suites present`);
}
