/**
 * Pure helpers of the postbuild step (plan WP3-20): inline script hashing, the OG image lookup in the built
 * home page, and the check that every inline script is covered by the CSP.
 */
import { createHash } from 'node:crypto';
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

/** Path (no origin) of the `og:image` of a built page; throws when absent or on a foreign host. */
export function ogImagePathOf(html: string): string {
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
  if (url.origin !== SITE_ORIGIN) throw new PostbuildError(`og:image "${content}" is not on ${SITE_ORIGIN}`);
  return url.pathname;
}
