// Legacy migration (plan WP-06): moves the 141 legacy photos into the new system through the guarded upload path.
// Scaffold only (step 1): argument parsing and usage. Dry-run planner, backends and upload follow in later steps.
// Usage: npm run migrate-legacy -- --help
import { pathToFileURL } from 'node:url';
import { parseArgs, USAGE } from './migrate-legacy/args';
import { UsageError } from './migrate-legacy/types';

/** Returns the process exit code. */
export function main(argv: string[], out: (line: string) => void = console.log, err: (line: string) => void = console.error): number {
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
  err('migrate-legacy: the migration itself is not implemented yet (scaffold). Use --help.');
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
