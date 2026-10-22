import { UsageError, type MigrateOptions } from './types';

export const USAGE = `Usage: npm run migrate-legacy -- [options]

Moves the legacy photos (legacy/fotky_web/galleries) into the new system.
Default is a dry-run: no network, no writes except migration-report/.

Options:
  --help                    Print this text and exit 0
  --live                    Write for real (needs --confirm-project and credentials)
  --confirm-project <ref>   Must equal the host label of SUPABASE_URL
  --album <id>              Only this legacy album (for example lucka_filip)
  --limit-bytes <n>         Stop before the run would write more than n bytes
  --repair                  Re-upload photos whose objects are missing (only works against a
                            Worker that allows re-presigning existing ids; not the case today)
  --alt default             Store the generated alt text (default: store null)
  --allow-host              Accept a Supabase host outside *.supabase.co and localhost

Environment (names only, see .env.example):
  MIGRATE_ACCESS_TOKEN (access token of a signed-in admin, lives about an hour),
  SUPABASE_URL, SUPABASE_ANON_KEY, API_BASE_URL, PUBLIC_IMG_BASE_URL
`;

function takeValue(argv: string[], i: number, flag: string): string {
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) throw new UsageError(`${flag} needs a value`);
  return v;
}

export function parseArgs(argv: string[]): MigrateOptions {
  const o: MigrateOptions = {
    help: false,
    live: false,
    confirmProject: null,
    album: null,
    limitBytes: null,
    repair: false,
    alt: 'null',
    allowHost: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    switch (a) {
      case '--help':
      case '-h':
        o.help = true;
        break;
      case '--live':
        o.live = true;
        break;
      case '--repair':
        o.repair = true;
        break;
      case '--allow-host':
        o.allowHost = true;
        break;
      case '--confirm-project':
        o.confirmProject = takeValue(argv, i++, a);
        break;
      case '--album':
        o.album = takeValue(argv, i++, a);
        break;
      case '--limit-bytes': {
        const n = Number(takeValue(argv, i++, a));
        if (!Number.isSafeInteger(n) || n <= 0) throw new UsageError('--limit-bytes needs a positive integer');
        o.limitBytes = n;
        break;
      }
      case '--alt': {
        const v = takeValue(argv, i++, a);
        if (v !== 'default') throw new UsageError('--alt accepts only: default');
        o.alt = 'default';
        break;
      }
      default:
        throw new UsageError(`unknown option ${a}`);
    }
  }
  return o;
}
