// Legacy migration (plan WP-06): moves the 141 legacy photos into the new system through the guarded upload path.
// Step 6: the default dry-run (no backend, no network). Live mode follows in later steps.
// Usage: npm run migrate-legacy -- --help
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { parseArgs, USAGE } from './migrate-legacy/args';
import { formatReport, planMigration, PlanError, writeReport, type PlanDeps } from './migrate-legacy/planner';
import { SourcePathError } from './migrate-legacy/sources';
import { UsageError, type MigrateOptions } from './migrate-legacy/types';
import { BackendError, type MigrationBackend } from './migrate-legacy/backend';
import { createHttpBackend, type FetchLike } from './migrate-legacy/http-backend';
import { formatCatalog, syncCatalog } from './migrate-legacy/catalog';
import { formatUpload, preflight, uploadComplete, uploadPhotos, type UploadDeps } from './migrate-legacy/upload';
import { coversComplete, formatCovers, syncCovers } from './migrate-legacy/cover';
import { buildFailedLiveReport, buildLiveReport, writeLiveReport } from './migrate-legacy/report';
import { checkLive, LiveGuardError, type Env } from './migrate-legacy/live-guard';

export interface MainDeps {
  /** Environment for the live guards. Default: process.env. */
  env?: Env;
  /** Injected HTTP layer for the live backend (tests). */
  fetch?: FetchLike;
  /** Replaces the HttpBackend entirely (tests). */
  backend?: MigrationBackend;
  plan?: PlanDeps;
  /** Live photo phase: source dir, file reader, backoff sleep (tests). */
  upload?: UploadDeps;
  /** Where migration-report/ goes. Default: <repo>/migration-report. */
  reportDir?: string;
  now?: () => Date;
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Live mode: guards first (exit 2, no request), then sign-in, then the catalog. Photo upload follows in T-156, T-157. */
async function runLive(
  options: MigrateOptions,
  out: (line: string) => void,
  err: (line: string) => void,
  deps: MainDeps,
): Promise<number> {
  let config;
  try {
    config = checkLive(options, deps.env ?? process.env);
  } catch (e) {
    if (e instanceof LiveGuardError) {
      err(`migrate-legacy: ${e.message}`);
      return 2;
    }
    throw e;
  }
  const backend =
    deps.backend ??
    createHttpBackend({
      supabaseUrl: config.supabaseUrl,
      anonKey: config.anonKey,
      apiBaseUrl: config.apiBaseUrl,
      ...(config.publicImgBaseUrl === undefined ? {} : { publicImgBaseUrl: config.publicImgBaseUrl }),
      credentials: config.credentials,
      ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
    });
  try {
    await backend.signIn();
  } catch (e) {
    // Fails closed: nothing has been written. Only the code is printed.
    const code = e instanceof BackendError ? e.code : 'UNKNOWN';
    err(
      code === 'NOT_ADMIN'
        ? 'migrate-legacy: the signed-in account is not an admin (NOT_ADMIN). Nothing was written.'
        : `migrate-legacy: sign-in failed (${code}). Nothing was written.`,
    );
    return 1;
  }
  out(`signed in as admin for project ${config.projectLabel}`);
  // Pre-flight first: read-only. A refusal leaves the backend untouched (not even the catalog is written).
  let pre;
  try {
    pre = await preflight(backend, options, deps.upload);
  } catch (e) {
    err(`migrate-legacy: pre-flight failed (${e instanceof BackendError ? e.code : (e as Error).message}). Nothing was written.`);
    return 1;
  }
  out(`pre-flight: ${pre.albums.reduce((s, a) => s + a.pending.length, 0)} photo(s) to upload, need ${pre.need} bytes, used ${pre.storage.used_bytes} of hard ${pre.storage.hard}`);
  if (pre.refusal !== null) {
    err(`migrate-legacy: refused, nothing was written: ${pre.refusal}`);
    return 1;
  }
  if (pre.warn) out(`WARNING: this run crosses the storage warn level (${pre.storage.warn} bytes)`);
  let catalog;
  try {
    catalog = await syncCatalog(backend, options);
    for (const line of formatCatalog(catalog)) out(line);
  } catch (e) {
    const code = e instanceof BackendError ? e.code : 'UNKNOWN';
    err(`migrate-legacy: catalog phase failed (${code}).`);
    return 1;
  }
  const reportDir = deps.reportDir ?? join(REPO_ROOT, 'migration-report');
  const stamp = (deps.now?.() ?? new Date()).toISOString().replace(/[:.]/g, '-');
  try {
    const report = await uploadPhotos(backend, pre, catalog.albumIds, { ...deps.upload, repair: options.repair, alt: options.alt });
    const covers = await syncCovers(backend, options);
    const lines = formatUpload(report);
    lines.pop(); // the upload-only RESULT line; the final one below also covers cover and order
    for (const line of lines) out(line);
    for (const line of formatCovers(covers)) out(line);
    const ok = uploadComplete(report) && coversComplete(covers);
    writeLiveReport(buildLiveReport(report, covers, options.alt, ok, catalog.drift), reportDir, stamp);
    out('report written to migration-report/');
    out(ok ? 'RESULT: OK' : 'RESULT: INCOMPLETE');
    return ok ? 0 : 1;
  } catch (e) {
    err(`migrate-legacy: upload phase failed (${e instanceof BackendError ? e.code : (e as Error).message}).`);
    // Still leave a report behind: catalog drift and an error label scrubbed of URLs, e-mails and credentials.
    try {
      const c = config.credentials;
      const secrets = [config.anonKey, ...('accessToken' in c ? [c.accessToken] : [c.email, c.password])];
      const label = e instanceof BackendError ? e.code : e instanceof Error ? e.message : 'UNKNOWN';
      writeLiveReport(buildFailedLiveReport(options.alt, pre.storage.used_bytes, catalog.drift, label, secrets), reportDir, stamp);
      out('report written to migration-report/');
    } catch {
      err('migrate-legacy: the report could not be written.');
    }
    out('RESULT: INCOMPLETE');
    return 1;
  }
}

/** Returns the process exit code. */
export async function main(
  argv: string[],
  out: (line: string) => void = console.log,
  err: (line: string) => void = console.error,
  deps: MainDeps = {},
): Promise<number> {
  let options;
  try {
    options = parseArgs(argv);
  } catch (e) {
    if (e instanceof UsageError) {
      err(`${e.message}\n\n${USAGE}`);
      return 2;
    }
    throw e;
  }
  if (options.help) {
    out(USAGE);
    return 0;
  }
  if (options.live) return runLive(options, out, err, deps);
  try {
    const plan = await planMigration(options, { publicImgBaseUrl: process.env.PUBLIC_IMG_BASE_URL, ...deps.plan });
    for (const line of formatReport(plan, options)) out(line);
    const stamp = (deps.now?.() ?? new Date()).toISOString().replace(/[:.]/g, '-');
    writeReport(plan, options, deps.reportDir ?? join(REPO_ROOT, 'migration-report'), stamp);
    out('report and legacy-image-redirects.txt written to migration-report/');
    return plan.result === 'OK' ? 0 : 1;
  } catch (e) {
    if (e instanceof PlanError || e instanceof SourcePathError) {
      err(`migrate-legacy: ${e.message}`);
      return 1;
    }
    throw e;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
