// Live-mode guards (plan WP-06 sections 3.2, 3.3). Pure: reads only the env object it is given, makes no
// request. Any failure is a LiveGuardError, which the entry script turns into exit 2 before any backend call.
// Messages name variables and flags, never values (a password or token must not reach any output).
import type { Credentials } from './http-backend';
import type { MigrateOptions } from './types';

export class LiveGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LiveGuardError';
  }
}

export interface LiveConfig {
  supabaseUrl: string;
  anonKey: string;
  apiBaseUrl: string;
  publicImgBaseUrl: string | undefined;
  credentials: Credentials;
  projectLabel: string;
}

export type Env = Record<string, string | undefined>;

const isLocal = (host: string) => host === 'localhost' || host === '127.0.0.1' || host === '[::1]';

function parseUrl(name: string, value: string | undefined): URL {
  if (!value) throw new LiveGuardError(`${name} is not set`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new LiveGuardError(`${name} is not a valid URL`);
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocal(url.hostname))) {
    throw new LiveGuardError(`${name} must use https (http is accepted for localhost only)`);
  }
  return url;
}

export function checkLive(options: Pick<MigrateOptions, 'confirmProject' | 'allowHost'>, env: Env): LiveConfig {
  if (!options.confirmProject) throw new LiveGuardError('--live needs --confirm-project <ref>');
  const supa = parseUrl('SUPABASE_URL', env.SUPABASE_URL);
  const host = supa.hostname.toLowerCase();
  const label = host.split('.')[0]!;
  if (options.confirmProject !== label) {
    throw new LiveGuardError('--confirm-project does not match the host label of SUPABASE_URL');
  }
  if (!isLocal(host) && !host.endsWith('.supabase.co') && !options.allowHost) {
    throw new LiveGuardError('SUPABASE_URL host is not *.supabase.co or localhost (use --allow-host to accept it)');
  }
  const api = parseUrl('API_BASE_URL', env.API_BASE_URL);
  if (!env.SUPABASE_ANON_KEY) throw new LiveGuardError('SUPABASE_ANON_KEY is not set');

  let credentials: Credentials;
  if (env.MIGRATE_ACCESS_TOKEN) {
    credentials = { accessToken: env.MIGRATE_ACCESS_TOKEN };
  } else if (env.MIGRATE_ADMIN_EMAIL && env.MIGRATE_ADMIN_PASSWORD) {
    credentials = { email: env.MIGRATE_ADMIN_EMAIL, password: env.MIGRATE_ADMIN_PASSWORD };
  } else {
    throw new LiveGuardError('credentials missing: set MIGRATE_ADMIN_EMAIL and MIGRATE_ADMIN_PASSWORD (or MIGRATE_ACCESS_TOKEN)');
  }
  return {
    supabaseUrl: supa.href.replace(/\/+$/, ''),
    anonKey: env.SUPABASE_ANON_KEY,
    apiBaseUrl: api.href.replace(/\/+$/, ''),
    publicImgBaseUrl: env.PUBLIC_IMG_BASE_URL || undefined,
    credentials,
    projectLabel: label,
  };
}
