/**
 * `_headers` generator (plan WP-3 section 4.7, MASTERPLAN security). Pure: returns the file text.
 *
 * Scripts: `script-src 'self'` plus one sha256 per inline script (the postbuild computes them from `dist`),
 * never `unsafe-inline`. Styles are external (`style-src 'self'`); `style-src-attr 'unsafe-inline'` is only for
 * the per-photo `--c` colour variable. Non-production output adds `X-Robots-Tag: noindex, nofollow`.
 *
 * Cache-Control: Pages joins the values of every matching rule, so the HTML default on `/*` is detached
 * (`! Cache-Control`) on the rules that set their own value. Detach syntax is UNVERIFIED on a live Pages
 * deploy (docs/VERIFY.md, `_headers` limits).
 */

export interface CspOptions {
  /** Origin of the image host (absolute), or a site-relative base; only an absolute different origin is listed. */
  imgOrigin?: string;
  /** Inline script hashes, as `sha256-<base64>` (without quotes). */
  scriptHashes?: readonly string[];
  /** WP-7 adds the Cloudflare beacon host here in one place. Not supported yet: always false. */
  analytics?: false;
}

export function buildCsp(options: CspOptions = {}): string {
  const img = ["'self'"];
  if (options.imgOrigin && /^https:\/\//.test(options.imgOrigin)) {
    const origin = new URL(options.imgOrigin).origin;
    if (!img.includes(origin)) img.push(origin);
  }
  img.push('data:');
  const scripts = ["'self'", ...[...new Set(options.scriptHashes ?? [])].sort().map((h) => `'${h}'`)];
  return [
    "default-src 'self'",
    `img-src ${img.join(' ')}`,
    "font-src 'self'",
    "style-src 'self'",
    "style-src-attr 'unsafe-inline'",
    `script-src ${scripts.join(' ')}`,
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join('; ');
}

export interface HeadersOptions extends CspOptions {
  /** True for every non-production build. */
  noindex: boolean;
}

const HTML_CACHE = 'public, max-age=0, must-revalidate';
const IMMUTABLE = 'public, max-age=31536000, immutable';

export function buildHeaders(options: HeadersOptions): string {
  const all = [
    'X-Content-Type-Options: nosniff',
    'Referrer-Policy: strict-origin-when-cross-origin',
    'Permissions-Policy: camera=(), microphone=(), geolocation=()',
    `Content-Security-Policy: ${buildCsp(options)}`,
    `Cache-Control: ${HTML_CACHE}`,
  ];
  if (options.noindex) all.push('X-Robots-Tag: noindex, nofollow');
  const block = (path: string, lines: string[]) => `${path}\n${lines.map((l) => `  ${l}`).join('\n')}\n`;
  return [
    block('/*', all),
    block('/_astro/*', ['! Cache-Control', `Cache-Control: ${IMMUTABLE}`]),
    block('/fonts/*', ['! Cache-Control', `Cache-Control: ${IMMUTABLE}`]),
    block('/_publish.json', ['! Cache-Control', 'Cache-Control: no-store', 'Access-Control-Allow-Origin: *']),
  ].join('\n');
}

/** The `Content-Security-Policy` value of the `/*` block of a `_headers` text, or null. */
export function cspOfHeaders(text: string): string | null {
  const m = /^\s*Content-Security-Policy:\s*(.+)$/m.exec(text);
  return m ? m[1]!.trim() : null;
}
