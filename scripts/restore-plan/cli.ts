/**
 * restore-plan CLI core (pure: all file access is injected, no network, no child processes).
 * The thin entry file scripts/restore-plan.ts wires the real fs.
 */
import { verifyBackupDocument } from '@mp/shared';
import { emitRestoreSql } from './sql';

export const USAGE = [
  'Usage: npm run restore-plan -- --from <catalog.json|full-*.json> --out <restore.sql> [--check] [--force]',
  '',
  '  --from <file>  backup document (catalog.json from the backup tool, or full-*.json from the private bucket)',
  '  --out <file>   where to write the restore SQL (refuses to overwrite an existing file without --force)',
  '  --check        validate only: print row counts and "integrity OK", write nothing',
  '  --force        overwrite an existing --out file',
  '  --help         show this text',
].join('\n');

export interface CliArgs {
  from?: string;
  out?: string;
  check: boolean;
  force: boolean;
  help: boolean;
}

export class UsageError extends Error {}

export function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { check: false, force: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--check') args.check = true;
    else if (a === '--force') args.force = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--from' || a === '--out') {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new UsageError(`${a} needs a value`);
      i++;
      if (a === '--from') args.from = v;
      else args.out = v;
    } else throw new UsageError(`unknown argument: ${a}`);
  }
  if (!args.help) {
    if (args.from === undefined) throw new UsageError('--from <file> is required');
    if (!args.check && args.out === undefined) throw new UsageError('--out <file> is required (or use --check)');
  }
  return args;
}

export interface RunDeps {
  readFile(path: string): string;
  writeFile(path: string, text: string): void;
  rename(from: string, to: string): void;
  exists(path: string): boolean;
  log(line: string): void;
  error(line: string): void;
}

export const HUMAN_STEPS = [
  'Next steps (all by hand, nothing was sent anywhere):',
  '  1. Apply the migrations first: supabase db push.',
  '  2. Create the two users and their admins rows as described in docs/ADMIN.md step 5.',
  '  3. Run the SQL file in the Supabase SQL editor as the owner (postgres role).',
  '  4. Then publish from the admin so the public site picks up the restored catalog.',
  '  Note: "alter table ... disable trigger user" is unverified on Supabase. If the editor refuses it,',
  '  use the commented fallback in the header of the SQL file.',
];

export function run(argv: readonly string[], deps: RunDeps): number {
  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    deps.error(`restore-plan: ${e.message}`);
    deps.error(USAGE);
    return 2;
  }
  if (args.help) {
    deps.log(USAGE);
    return 0;
  }
  const from = args.from!;

  let raw: unknown;
  try {
    raw = JSON.parse(deps.readFile(from));
  } catch {
    deps.error(`restore-plan: cannot read ${from} as JSON`);
    return 1;
  }

  const verdict = verifyBackupDocument(raw);
  if (!verdict.ok) {
    deps.error(`restore-plan: ${from} failed verification (${verdict.issues.length} issue(s)); nothing written`);
    for (const issue of verdict.issues) deps.error(`  ${issue.path}: ${issue.message}`);
    return 1;
  }
  const doc = verdict.doc;

  if (args.check) {
    deps.log(`categories: ${doc.categories.length}`);
    deps.log(`albums: ${doc.albums.length}`);
    deps.log(`photos: ${doc.photos.length}`);
    deps.log(`url_history: ${doc.urlHistory.length}`);
    deps.log('integrity OK');
    return 0;
  }

  const out = args.out!;
  if (deps.exists(out) && !args.force) {
    deps.error(`restore-plan: ${out} already exists; use --force to overwrite`);
    return 1;
  }
  let sql: string;
  try {
    sql = emitRestoreSql(doc);
  } catch {
    deps.error('restore-plan: could not build the SQL (a value is not representable); nothing written');
    return 1;
  }
  const tmp = `${out}.tmp`;
  try {
    deps.writeFile(tmp, sql);
    deps.rename(tmp, out);
  } catch {
    deps.error(`restore-plan: could not write ${out}`);
    return 1;
  }
  deps.log(`integrity OK; wrote ${out}`);
  for (const line of HUMAN_STEPS) deps.log(line);
  return 0;
}
