// Backup CLI core (plan WP-08 section 4.3, T-192). Testable: parseArgs + run(argv, deps) with every side effect
// injected (fs, directory listing, fetch, log, env). The thin entry scripts/backup.ts wires the real ones.
// Read-only towards live services. Without --live nothing is read, contacted or written. Messages name
// environment variables and flags, never their values.
import { isAbsolute, relative, resolve } from 'node:path';
import type { FetchLike } from '../migrate-legacy/http-backend';
import { checkLive, LiveGuardError, type Env } from '../migrate-legacy/live-guard';
import { BackupError } from './catalog';
import { CapError, parseImgBase, type BackupFs } from './masters';
import { runBackup } from './run';

/** The one place inside the repo where --out is accepted; it is listed in .gitignore. */
export const IGNORED_OUT_DIR = 'backup-out';
/** Files and folders the tool itself creates; anything else in a non-empty --out needs --update. */
export const KNOWN_ENTRIES: readonly string[] = ['catalog.json', 'manifest.json', 'masters'];

export const DEFAULT_MAX_PHOTOS = 2000;
/** Just above the hard storage limit (9.5e9), so a normal full backup is never refused by default. */
export const DEFAULT_MAX_BYTES = 10_000_000_000;

export const USAGE = [
  'Usage: npm run backup -- --out <dir> [--live] [--dry-run] [--update] [--max-photos <n>] [--max-bytes <n>]',
  '',
  '  --out <dir>        where the backup goes (required); made absolute. Inside the repo only under backup-out/',
  '  --live             really read Supabase and the image host (needs the environment variables below)',
  '  --dry-run          print the plan and touch nothing (this is the default)',
  '  --update           accept a non-empty --out that holds files other than catalog.json, manifest.json, masters/',
  `  --max-photos <n>   refuse when the catalog has more photos (default ${DEFAULT_MAX_PHOTOS})`,
  `  --max-bytes <n>    refuse when the declared master sizes add up to more (default ${DEFAULT_MAX_BYTES})`,
  '  --help             show this text',
  '',
  'Environment for --live (read at run time, never printed):',
  '  SUPABASE_URL, SUPABASE_ANON_KEY, PUBLIC_IMG_BASE_URL',
  '  MIGRATE_ADMIN_EMAIL and MIGRATE_ADMIN_PASSWORD (or MIGRATE_ACCESS_TOKEN)',
].join('\n');

export class UsageError extends Error {}

export interface CliArgs {
  out?: string;
  live: boolean;
  dryRun: boolean;
  update: boolean;
  maxPhotos: number;
  maxBytes: number;
  help: boolean;
}

function positiveInt(flag: string, value: string): number {
  if (!/^\d+$/.test(value)) throw new UsageError(`${flag} needs a positive whole number`);
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) throw new UsageError(`${flag} needs a positive whole number`);
  return n;
}

export function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { live: false, dryRun: false, update: false, maxPhotos: DEFAULT_MAX_PHOTOS, maxBytes: DEFAULT_MAX_BYTES, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--live') args.live = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--update') args.update = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--out' || a === '--max-photos' || a === '--max-bytes') {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new UsageError(`${a} needs a value`);
      i++;
      if (a === '--out') args.out = v;
      else if (a === '--max-photos') args.maxPhotos = positiveInt(a, v);
      else args.maxBytes = positiveInt(a, v);
    } else throw new UsageError(`unknown argument: ${a}`);
  }
  if (!args.help) {
    if (args.out === undefined || args.out === '') throw new UsageError('--out <dir> is required');
    if (args.live && args.dryRun) throw new UsageError('--live and --dry-run exclude each other');
  }
  return args;
}

export interface CliDeps {
  env: Env;
  /** Base for a relative --out. */
  cwd: string;
  /** Root of the git checkout; --out inside it is refused except under backup-out/. */
  repoRoot: string;
  fs: BackupFs;
  /** Entry names of a directory; null when it does not exist. */
  listDir(path: string): Promise<string[] | null>;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  log(line: string): void;
  error(line: string): void;
}

const isInside = (parent: string, child: string): boolean => {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

/** Returns the absolute --out, or an error text. Pure: only path arithmetic, nothing is touched. */
export function resolveOut(out: string, cwd: string, repoRoot: string): { ok: true; path: string } | { ok: false; reason: string } {
  const path = resolve(cwd, out);
  const root = resolve(repoRoot);
  if (isInside(root, path) && !isInside(resolve(root, IGNORED_OUT_DIR), path)) {
    return { ok: false, reason: `--out must not be inside the repository (tracked files). Use a folder outside it, or one under ${IGNORED_OUT_DIR}/` };
  }
  if (isInside(path, root)) return { ok: false, reason: '--out must not contain the repository' };
  return { ok: true, path };
}

/** Names of required environment variables that are unset (names only). */
export function missingLiveEnv(env: Env): string[] {
  const missing: string[] = [];
  for (const name of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'PUBLIC_IMG_BASE_URL']) if (!env[name]) missing.push(name);
  if (!env.MIGRATE_ACCESS_TOKEN && !(env.MIGRATE_ADMIN_EMAIL && env.MIGRATE_ADMIN_PASSWORD)) {
    if (!env.MIGRATE_ADMIN_EMAIL) missing.push('MIGRATE_ADMIN_EMAIL');
    if (!env.MIGRATE_ADMIN_PASSWORD) missing.push('MIGRATE_ADMIN_PASSWORD');
    missing.push('(or MIGRATE_ACCESS_TOKEN instead of both)');
  }
  return missing;
}

function plan(args: CliArgs, out: string, env: Env, log: (l: string) => void): void {
  log('backup: DRY RUN. Nothing is read, contacted or written.');
  log(`  would write to:  ${out}`);
  log('  would read:      the catalog tables (categories, albums, photos, url_history) from Supabase, read-only');
  log('                   and each photo master from the public image host (GET only)');
  log('  would write:     catalog.json, manifest.json, masters/<photo id>.jpg');
  log(`  caps:            at most ${args.maxPhotos} photos, ${args.maxBytes} bytes`);
  log(`  flags:           --update ${args.update ? 'on' : 'off'}`);
  const missing = missingLiveEnv(env);
  log(missing.length === 0 ? '  live run needs:  all environment variables are set' : `  live run needs:  still unset: ${missing.join(', ')}`);
  log('Run again with --live to do it for real.');
}

export async function run(argv: readonly string[], deps: CliDeps): Promise<number> {
  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    deps.error(`backup: ${e.message}`);
    deps.error(USAGE);
    return 2;
  }
  if (args.help) {
    deps.log(USAGE);
    return 0;
  }
  const resolved = resolveOut(args.out!, deps.cwd, deps.repoRoot);
  if (!resolved.ok) {
    deps.error(`backup: ${resolved.reason}`);
    return 2;
  }
  const outDir = resolved.path;

  if (!args.live) {
    plan(args, outDir, deps.env, (l) => deps.log(l));
    return 0;
  }

  // ---- live guards: all before any request
  const missing = missingLiveEnv(deps.env);
  if (missing.length > 0) {
    deps.error(`backup: --live needs these environment variables: ${missing.join(', ')}`);
    return 2;
  }
  let config;
  try {
    const host = new URL(deps.env.SUPABASE_URL!).hostname.toLowerCase();
    // The backup is read-only and has no --confirm-project flag; the guard still checks URL shape and host.
    config = checkLive(
      { confirmProject: host.split('.')[0] || 'x', allowHost: false },
      { ...deps.env, API_BASE_URL: deps.env.API_BASE_URL || deps.env.SUPABASE_URL },
    );
    parseImgBase(deps.env.PUBLIC_IMG_BASE_URL!);
  } catch (e) {
    if (e instanceof LiveGuardError || (e instanceof Error && e.message.startsWith('PUBLIC_IMG_BASE_URL'))) deps.error(`backup: ${e.message}`);
    else deps.error('backup: SUPABASE_URL is not a valid URL');
    return 2;
  }

  const existing = await deps.listDir(outDir);
  if (existing !== null && existing.length > 0 && !args.update) {
    const unknown = existing.filter((n) => !KNOWN_ENTRIES.includes(n));
    if (unknown.length > 0) {
      deps.error(`backup: ${outDir} is not empty and holds ${unknown.length} file(s) this tool did not create; use an empty folder or pass --update`);
      return 1;
    }
  }

  try {
    const res = await runBackup({
      catalog: { supabaseUrl: config.supabaseUrl, anonKey: config.anonKey, credentials: config.credentials },
      imgBaseUrl: deps.env.PUBLIC_IMG_BASE_URL!,
      outDir,
      fs: deps.fs,
      ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
      ...(deps.sleep === undefined ? {} : { sleep: deps.sleep }),
      ...(deps.now === undefined ? {} : { now: deps.now }),
      maxPhotos: args.maxPhotos,
      maxBytes: args.maxBytes,
    });
    const protectedBytes = res.masters.manifest.entries.reduce((s, e) => s + e.bytes, 0);
    deps.log('backup summary');
    deps.log(`  catalog:  ${res.counts.categories} categories, ${res.counts.albums} albums, ${res.counts.photos} photos, ${res.counts.urlHistory} url_history`);
    deps.log(`  masters:  ${res.masters.written} written, ${res.masters.skipped} skipped (already up to date), ${res.failed.length} failed`);
    deps.log(`  bytes:    ${res.masters.downloadedBytes} downloaded now, ${protectedBytes} in the backup in total`);
    for (const f of res.failed) deps.log(`  failed:   ${f.id} (${f.code}${f.status === undefined ? '' : ` ${f.status}`})`);
    deps.log(`  output:   ${outDir}`);
    deps.log(res.failed.length === 0 ? 'RESULT: OK' : 'RESULT: INCOMPLETE (some masters could not be saved; the rest was written)');
    return res.failed.length === 0 ? 0 : 1;
  } catch (e) {
    // Codes only: no URLs, bodies or credentials.
    if (e instanceof CapError) deps.error(`backup: refused, over the ${e.code === 'MAX_PHOTOS' ? '--max-photos' : '--max-bytes'} cap (${e.code}). Nothing was written.`);
    else if (e instanceof BackupError) deps.error(`backup: failed (${e.code}). Nothing was written.`);
    else deps.error('backup: failed (unexpected error).');
    return 1;
  }
}
