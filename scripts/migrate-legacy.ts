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
import { checkLive, LiveGuardError, type Env } from './migrate-legacy/live-guard';

export interface MainDeps {
  /** Environment for the live guards. Default: process.env. */
  env?: Env;
  /** Injected HTTP layer for the live backend (tests). */
  fetch?: FetchLike;
  /** Replaces the HttpBackend entirely (tests). */
  backend?: MigrationBackend;
  plan?: PlanDeps;
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
  try {
    for (const line of formatCatalog(await syncCatalog(backend, options))) out(line);
  } catch (e) {
    const code = e instanceof BackendError ? e.code : 'UNKNOWN';
    err(`migrate-legacy: catalog phase failed (${code}).`);
    return 1;
  }
  err('migrate-legacy: photos not implemented yet (T-156). Only the catalog was written.');
  return 1;
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
