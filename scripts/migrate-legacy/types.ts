// Shared types for the legacy migration script (plan WP-06). Scaffold: later steps add the backend interface.

/** Parsed command line of `npm run migrate-legacy`. Default is a dry-run: no network, no writes. */
export interface MigrateOptions {
  help: boolean;
  /** Real run against Supabase and the Worker. Needs confirmProject too. */
  live: boolean;
  /** Project ref that must equal the host label of SUPABASE_URL (live only). */
  confirmProject: string | null;
  /** Limit the run to one legacy album id. */
  album: string | null;
  /** Optional byte ceiling for the run. */
  limitBytes: number | null;
  /** Re-upload photos whose rows exist but whose objects are missing. */
  repair: boolean;
  /** 'default' stores the generated alt text; 'null' (default) stores null. */
  alt: 'null' | 'default';
  /** Allow a Supabase host that is not *.supabase.co or localhost. */
  allowHost: boolean;
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}
