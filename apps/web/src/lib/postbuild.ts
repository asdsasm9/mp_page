/**
 * Pure helpers of the postbuild step (plan WP3-20): inline script hashing, the OG image lookup in the built
 * home page, and the check that every inline script is covered by the CSP.
 */
import { createHash } from 'node:crypto';
import { COOKIES } from '../content/texts';
import { BEACON_SRC } from './beacon';
import { ANALYTICS_CONNECT_HOST, ANALYTICS_SCRIPT_HOST, cspOfHeaders } from './headers';
import { SITE_ORIGIN } from './jsonld';

export class PostbuildError extends Error {
  constructor(message: string) {
    super(`postbuild: ${message}`);
    this.name = 'PostbuildError';
  }
}

const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;

/** `sha256-<base64>` of the exact script text, as a CSP hash source (without quotes). */
export function scriptHash(text: string): string {
  return `sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}`;
}

/** Texts of the executable inline scripts of a page (no `src`, not JSON-LD or another data block). */
export function inlineScripts(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(SCRIPT_RE)) {
    const attrs = m[1] ?? '';
    const body = m[2] ?? '';
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1]?.toLowerCase();
    if (type === 'application/ld+json') continue;
    if (body.trim() === '') continue;
    out.push(body);
  }
  return out;
}

/** Sorted, unique hashes of all inline scripts of the given pages. */
export function collectScriptHashes(pages: ReadonlyArray<{ path: string; html: string }>): string[] {
  const hashes = new Set<string>();
  for (const page of pages) for (const s of inlineScripts(page.html)) hashes.add(scriptHash(s));
  return [...hashes].sort();
}

/** Pages whose inline scripts are not covered by `script-src` of the given CSP. Empty list means green. */
export function missingScriptHashes(
  pages: ReadonlyArray<{ path: string; html: string }>,
  csp: string,
): Array<{ path: string; hash: string }> {
  const scriptSrc = /(?:^|;)\s*script-src\s+([^;]*)/.exec(csp)?.[1] ?? '';
  const allowed = new Set(scriptSrc.split(/\s+/).map((t) => t.replace(/^'|'$/g, '')));
  const missing: Array<{ path: string; hash: string }> = [];
  for (const page of pages) {
    for (const s of inlineScripts(page.html)) {
      const hash = scriptHash(s);
      if (!allowed.has(hash)) missing.push({ path: page.path, hash });
    }
  }
  return missing;
}

const BEACON_TAG_RE = /<script\b[^>]*>/gi;
const FORBIDDEN_STORAGE_RE = /document\.cookie|localStorage|sessionStorage/;
const FORBIDDEN_GOOGLE_RE = /googletagmanager|google-analytics|gtag\s*\(/i;

function unescapeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#0*34;/g, '"')
    .replace(/&#x0*22;/gi, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Beacon script tags of a page: `src` pointing at the beacon, or a `data-cf-beacon` attribute; with parsed token. */
function beaconTags(html: string): Array<{ src: string | null; token: string | null }> {
  const out: Array<{ src: string | null; token: string | null }> = [];
  for (const m of html.matchAll(BEACON_TAG_RE)) {
    const tag = m[0];
    const src = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    const srcValue = src ? unescapeEntities(src[1] ?? src[2] ?? '') : null;
    const cfAttr = /\bdata-cf-beacon\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    if (!/cloudflareinsights/i.test(srcValue ?? '') && !cfAttr) continue;
    let token: string | null = null;
    if (cfAttr) {
      try {
        const parsed = JSON.parse(unescapeEntities(cfAttr[1] ?? cfAttr[2] ?? '')) as { token?: unknown };
        token = typeof parsed.token === 'string' ? parsed.token : null;
      } catch {
        token = null;
      }
    }
    out.push({ src: srcValue, token });
  }
  return out;
}

const COOKIES_PAGE_RE = /(?:^|\/)cookies\/index\.html$/;
const BEACON_WORDS_RE = /cloudflareinsights|data-cf-beacon|beacon\.min\.js/i;

/** Page html with the beacon script start tags removed (what is left must not mention the beacon at all). */
function withoutBeaconTags(html: string): string {
  return html.replace(BEACON_TAG_RE, (tag) => {
    const src = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    const srcValue = src ? unescapeEntities(src[1] ?? src[2] ?? '') : '';
    return /cloudflareinsights/i.test(srcValue) || /\bdata-cf-beacon\s*=/i.test(tag) ? '' : tag;
  });
}

export interface AnalyticsOutputInput {
  pages: ReadonlyArray<{ path: string; html: string }>;
  /** Text of the written `_headers` file. */
  headersText: string;
  /** Beacon token of the build, or null for a token-less build. */
  token: string | null;
  /** Optional: built own JS files (`dist/_astro/*.js`), scanned for cookie and storage access. */
  scripts?: ReadonlyArray<{ path: string; text: string }>;
}

/** Problems with the analytics output of a build (plan WP-7 section 6). Empty list means green. */
export function checkAnalyticsOutput({ pages, headersText, token, scripts = [] }: AnalyticsOutputInput): string[] {
  const errors: string[] = [];
  const csp = cspOfHeaders(headersText) ?? '';
  const directive = (name: string) => new RegExp(`(?:^|;)\\s*${name}\\s+([^;]*)`).exec(csp)?.[1]?.split(/\s+/) ?? [];

  if (token === null) {
    if (/cloudflareinsights/i.test(csp)) errors.push('CSP names cloudflareinsights in a token-less build');
  } else {
    if (!directive('script-src').includes(ANALYTICS_SCRIPT_HOST)) errors.push(`CSP script-src lacks ${ANALYTICS_SCRIPT_HOST}`);
    if (!directive('connect-src').includes(ANALYTICS_CONNECT_HOST)) errors.push(`CSP connect-src lacks ${ANALYTICS_CONNECT_HOST}`);
  }

  if (token !== null && pages.length === 0) errors.push('a build with an analytics token has no html pages to carry the beacon');

  for (const page of pages) {
    const tags = beaconTags(page.html);
    if (token === null) {
      if (tags.length > 0 || /cloudflareinsights|data-cf-beacon/i.test(page.html)) {
        errors.push(`${page.path}: beacon present in a token-less build`);
      }
    } else {
      if (tags.length !== 1) {
        errors.push(`${page.path}: expected exactly one beacon tag, found ${tags.length}`);
      } else {
        const tag = tags[0]!;
        if (tag.src !== BEACON_SRC) errors.push(`${page.path}: beacon src is not ${BEACON_SRC}`);
        if (tag.token !== token) errors.push(`${page.path}: beacon data-cf-beacon token does not match the build token`);
      }
      if (BEACON_WORDS_RE.test(withoutBeaconTags(page.html))) {
        errors.push(`${page.path}: beacon reference outside the one expected beacon tag`);
      }
    }
    if (COOKIES_PAGE_RE.test(page.path)) {
      const has = page.html.includes(COOKIES.ANALYTICS_PARAGRAPH);
      if (token !== null && !has) errors.push(`${page.path}: privacy page lacks the analytics paragraph in a build with a beacon`);
      if (token === null && has) errors.push(`${page.path}: privacy page has the analytics paragraph in a token-less build`);
    }
    if (FORBIDDEN_GOOGLE_RE.test(page.html)) errors.push(`${page.path}: Google analytics reference (googletagmanager, google-analytics or gtag()`);
    for (const s of inlineScripts(page.html)) {
      if (FORBIDDEN_STORAGE_RE.test(s)) errors.push(`${page.path}: inline script touches document.cookie, localStorage or sessionStorage`);
      if (FORBIDDEN_GOOGLE_RE.test(s)) errors.push(`${page.path}: inline script references Google analytics`);
    }
  }

  for (const js of scripts) {
    if (FORBIDDEN_STORAGE_RE.test(js.text)) errors.push(`${js.path}: touches document.cookie, localStorage or sessionStorage`);
    if (FORBIDDEN_GOOGLE_RE.test(js.text)) errors.push(`${js.path}: references Google analytics`);
  }
  return errors;
}

/**
 * Redirect target for the `og:image` of a built page; throws when absent or on a foreign host. A site-origin image
 * gives its path; an image on the configured image host (`imgOrigin`, where production photos live) gives the full
 * URL, which the redirects check accepts as an image-host target. No file check, so the build needs no network.
 */
export function ogImagePathOf(html: string, imgOrigin?: string): string {
  const tag = /<meta\b[^>]*\bproperty=["']og:image["'][^>]*>/i.exec(html)?.[0];
  const content = tag ? /\bcontent=["']([^"']+)["']/i.exec(tag)?.[1] : undefined;
  if (!content) throw new PostbuildError('the built home page has no og:image');
  if (content.startsWith('/') && !content.startsWith('//')) return content;
  let url: URL;
  try {
    url = new URL(content);
  } catch {
    throw new PostbuildError(`og:image "${content}" is not a URL`);
  }
  if (url.origin === SITE_ORIGIN) return url.pathname;
  if (imgOrigin && url.origin === new URL(imgOrigin, SITE_ORIGIN).origin) return url.href;
  throw new PostbuildError(`og:image "${content}" is not on ${SITE_ORIGIN}${imgOrigin ? ` or the image host ${imgOrigin}` : ''}`);
}
