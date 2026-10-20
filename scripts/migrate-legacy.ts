// Legacy migration (plan WP-06): moves the 141 legacy photos into the new system through the guarded upload path.
// Step 6: the default dry-run (no backend, no network). Live mode follows in later steps.
// Usage: npm run migrate-legacy -- --help
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { parseArgs, USAGE } from './migrate-legacy/args';
import { formatReport, planMigration, PlanError, writeReport, type PlanDeps } from './migrate-legacy/planner';
import { SourcePathError } from './migrate-legacy/sources';
import { UsageError } from './migrate-legacy/types';

export interface MainDeps {
  plan?: PlanDeps;
  /** Where migration-report/ goes. Default: <repo>/migration-report. */
  reportDir?: string;
  now?: () => Date;
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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
  if (options.live) {
    err('migrate-legacy: --live is not implemented yet. Run without --live for the dry-run.');
    return 2;
  }
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
