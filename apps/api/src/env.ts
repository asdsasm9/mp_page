/**
 * Worker configuration (WP-4 section 4.2). Validated on every request; a failure reports only the
 * NAMES of the offending variables (never values) so the caller can log them safely.
 */

/** Raw bindings as the runtime hands them over (strings, or anything for a missing/odd binding). */
export type RawEnv = Record<string, unknown>;

export interface Config {
  supabaseUrl: string;
  supabaseAnonKey: string;
  r2AccountId: string;
  r2AccessKeyId: string;
  r2SecretAccessKey: string;
  r2Bucket: string;
  r2BackupBucket: string;
  r2PublicBaseUrl: string;
  pagesDeployHookUrl: string;
  allowedOrigins: string[];
}

export type EnvResult = { ok: true; config: Config } | { ok: false; invalid: string[] };

export interface EnvOptions {
  /** Tests only: accept http:// for SUPABASE_URL and R2_PUBLIC_BASE_URL. */
  allowInsecureUrls?: boolean;
}

function text(raw: RawEnv, name: string): string | null {
  const v = raw[name];
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
}

function urlOk(value: string, allowInsecure: boolean): boolean {
  try {
    const u = new URL(value);
    if (u.username || u.password) return false;
    return u.protocol === 'https:' || (allowInsecure && u.protocol === 'http:');
  } catch {
    return false;
  }
}

/** An exact origin: scheme and host (and port) only, in canonical form. No wildcard, no `null`. */
export function isExactOrigin(value: string): boolean {
  if (value === 'null' || value.includes('*')) return false;
  try {
    const u = new URL(value);
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.origin === value;
  } catch {
    return false;
  }
}

/** Comma-separated exact origins; null when empty or any entry is not an exact origin. */
export function parseAllowedOrigins(value: string): string[] | null {
  const parts = value.split(',').map((p) => p.trim());
  if (parts.length === 0 || parts.some((p) => !isExactOrigin(p))) return null;
  return parts;
}

export function parseEnv(raw: RawEnv | undefined, options: EnvOptions = {}): EnvResult {
  const env = raw ?? {};
  const insecure = options.allowInsecureUrls === true;
  const invalid: string[] = [];

  const req = (name: string, ok: (v: string) => boolean = () => true): string => {
    const v = text(env, name);
    if (v === null || !ok(v)) {
      invalid.push(name);
      return '';
    }
    return v;
  };

  const supabaseUrl = req('SUPABASE_URL', (v) => urlOk(v, insecure));
  const supabaseAnonKey = req('SUPABASE_ANON_KEY');
  const r2AccountId = req('R2_ACCOUNT_ID', (v) => /^[0-9a-f]{32}$/.test(v));
  const r2AccessKeyId = req('R2_ACCESS_KEY_ID');
  const r2SecretAccessKey = req('R2_SECRET_ACCESS_KEY');
  const r2Bucket = req('R2_BUCKET', (v) => /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(v));
  const r2BackupBucket = req('R2_BACKUP_BUCKET', (v) => /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(v));
  const r2PublicBaseUrl = req('R2_PUBLIC_BASE_URL', (v) => urlOk(v, insecure));
  const pagesDeployHookUrl = req('PAGES_DEPLOY_HOOK_URL', (v) => urlOk(v, false));
  const originsRaw = req('ALLOWED_ORIGINS', (v) => parseAllowedOrigins(v) !== null);

  if (invalid.length > 0) return { ok: false, invalid };

  return {
    ok: true,
    config: {
      supabaseUrl: supabaseUrl.replace(/\/+$/, ''),
      supabaseAnonKey,
      r2AccountId,
      r2AccessKeyId,
      r2SecretAccessKey,
      r2Bucket,
      r2BackupBucket,
      r2PublicBaseUrl: r2PublicBaseUrl.replace(/\/+$/, ''),
      pagesDeployHookUrl,
      allowedOrigins: parseAllowedOrigins(originsRaw) ?? [],
    },
  };
}
