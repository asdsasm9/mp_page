/**
 * Build-time environment for the public site (plan WP-3, section 4.1).
 * Pure: takes the raw variables, returns a validated description or throws BuildConfigError.
 * Only public values are read here (URLs and the environment name); the build never receives secrets.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const DEV_IMG_BASE = '/_dev-img';
export const DEV_IMG_DIR = '_dev-img';

export type SiteEnv = 'production' | 'preview' | 'local';

export interface WebEnv {
  /** `production` and `preview` only when PUBLIC_SITE_ENV says exactly so; anything else is `local`. */
  siteEnv: SiteEnv;
  production: boolean;
  source: 'snapshot' | 'fixture';
  /** Set in snapshot mode only. */
  snapshotUrl: string | null;
  /** Image base URL without a trailing slash (an absolute https URL, or `/_dev-img` in fixture mode). */
  imgBaseUrl: string;
  /** Every non-production build is noindex (meta, header, robots.txt). */
  noindex: boolean;
  /** Exact origin of the admin app allowed to read `/_publish.json` cross-origin, or null (no CORS header). */
  adminOrigin: string | null;
  /** Cloudflare Web Analytics token (public value), production builds only; null = no beacon, no CSP hosts. */
  analyticsToken: string | null;
}

export class BuildConfigError extends Error {
  readonly code = 'BUILD_CONFIG' as const;
  constructor(message: string) {
    super(message);
    this.name = 'BuildConfigError';
  }
}

export type RawEnv = Record<string, string | undefined>;

const trimmed = (v: string | undefined): string => (v ?? '').trim();

function parseHttpsUrl(name: string, value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BuildConfigError(`${name} is not a valid URL`);
  }
  if (url.protocol !== 'https:') throw new BuildConfigError(`${name} must be an https URL`);
  return url;
}

/**
 * PUBLIC_ADMIN_ORIGIN: unset/blank = null. Otherwise exactly one origin (scheme + host + optional port): no wildcard,
 * path, query, fragment or credentials, and https for a production build. Anything else fails the build.
 */
function parseAdminOrigin(value: string, production: boolean): string | null {
  if (value === '') return null;
  const bad = (why: string) => new BuildConfigError(`PUBLIC_ADMIN_ORIGIN ${why} (expected one origin such as https://admin.example.cz)`);
  if (value.includes('*')) throw bad('must not contain a wildcard');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw bad('is not a valid URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw bad('must be an http(s) origin');
  if (url.protocol === 'http:' && production) throw bad('must be https in a production build');
  if (value !== url.origin) throw bad('must be an origin only, without path, trailing slash, query or credentials');
  return url.origin;
}

/**
 * PUBLIC_CF_ANALYTICS_TOKEN: only a production build uses it (local and preview: always null). Blank = null.
 * Otherwise 16-64 alphanumerics; on failure the message names the variable and never the value.
 */
export function analyticsToken(raw: RawEnv, production: boolean): string | null {
  if (!production) return null;
  const value = trimmed(raw.PUBLIC_CF_ANALYTICS_TOKEN);
  if (value === '') return null;
  if (!/^[A-Za-z0-9]{16,64}$/.test(value)) {
    throw new BuildConfigError('PUBLIC_CF_ANALYTICS_TOKEN is not a valid token (expected 16-64 letters and digits)');
  }
  return value;
}

/**
 * Fixture mode (no PUBLIC_SNAPSHOT_URL): committed fixture, image base defaults to /_dev-img, always noindex.
 * Snapshot mode: https snapshot URL, https image base, and both on the same host.
 * Production additionally needs snapshot mode. The default is the safe direction (noindex).
 */
export function resolveEnv(raw: RawEnv): WebEnv {
  const flag = trimmed(raw.PUBLIC_SITE_ENV);
  const siteEnv: SiteEnv = flag === 'production' || flag === 'preview' ? flag : 'local';
  const production = siteEnv === 'production';
  const snapshotRaw = trimmed(raw.PUBLIC_SNAPSHOT_URL);
  const imgRaw = trimmed(raw.PUBLIC_IMG_BASE_URL);
  const adminOrigin = parseAdminOrigin(trimmed(raw.PUBLIC_ADMIN_ORIGIN), production);
  const token = analyticsToken(raw, production);

  if (snapshotRaw === '') {
    if (production) {
      throw new BuildConfigError('PUBLIC_SITE_ENV=production requires PUBLIC_SNAPSHOT_URL (snapshot mode)');
    }
    return {
      siteEnv,
      production,
      source: 'fixture',
      snapshotUrl: null,
      imgBaseUrl: (imgRaw === '' ? DEV_IMG_BASE : imgRaw).replace(/\/+$/, ''),
      noindex: true,
      adminOrigin,
      analyticsToken: token,
    };
  }

  const snapshotUrl = parseHttpsUrl('PUBLIC_SNAPSHOT_URL', snapshotRaw);
  if (imgRaw === '') throw new BuildConfigError('PUBLIC_IMG_BASE_URL is required in snapshot mode');
  const imgUrl = parseHttpsUrl('PUBLIC_IMG_BASE_URL', imgRaw);
  if (snapshotUrl.host !== imgUrl.host) {
    throw new BuildConfigError('PUBLIC_SNAPSHOT_URL host must equal the PUBLIC_IMG_BASE_URL host');
  }
  return {
    siteEnv,
    production,
    source: 'snapshot',
    snapshotUrl: snapshotUrl.href,
    imgBaseUrl: imgUrl.href.replace(/\/+$/, ''),
    noindex: !production,
    adminOrigin,
    analyticsToken: token,
  };
}

/** Reads the variables from `import.meta.env` or `process.env` (whichever has them). */
export function readRawEnv(): RawEnv {
  const meta = (import.meta as unknown as { env?: RawEnv }).env ?? {};
  const proc = typeof process !== 'undefined' ? process.env : {};
  const pick = (k: string) => proc[k] ?? meta[k];
  return {
    PUBLIC_SITE_ENV: pick('PUBLIC_SITE_ENV'),
    PUBLIC_SNAPSHOT_URL: pick('PUBLIC_SNAPSHOT_URL'),
    PUBLIC_IMG_BASE_URL: pick('PUBLIC_IMG_BASE_URL'),
    PUBLIC_ADMIN_ORIGIN: pick('PUBLIC_ADMIN_ORIGIN'),
    PUBLIC_CF_ANALYTICS_TOKEN: pick('PUBLIC_CF_ANALYTICS_TOKEN'),
  };
}

/**
 * Post-build production guard: a production build must not contain the dev images directory.
 * `exists` is injectable for tests.
 */
export function assertProductionOutput(
  env: Pick<WebEnv, 'production'>,
  distDir: string,
  exists: (path: string) => boolean = existsSync,
): void {
  if (env.production && exists(join(distDir, DEV_IMG_DIR))) {
    throw new BuildConfigError(`production output must not contain ${DEV_IMG_DIR} (dev images in ${distDir})`);
  }
}
