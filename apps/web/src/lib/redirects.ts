/**
 * `_redirects` generator (plan 4.7, CONTENT-MAPPING 7.3). Pure: returns the file text or throws RedirectsError.
 *
 * Static rows: explicit ids per old category path (no wildcard), no `/portfolio` rows (D-6: `/portfolio/` is a real
 * page and Pages already normalises the trailing slash), `/manifest.json`, and the old share image.
 * Data rows come from `snapshot.redirects` (url_history, including the 141 legacy image rows with absolute
 * image-host targets). Validation keeps a data row from becoming an open redirect or injecting file syntax.
 *
 * 410 rows: Pages support for status 410 in `_redirects` is UNVERIFIED (docs/VERIFY.md row 17), so by default
 * they are dropped and the path 404s. Pass `emit410: true` once verified.
 */
import type { Snapshot } from '@mp/shared';
import { SITE_ORIGIN } from './jsonld';

type SnapshotRedirect = Snapshot['redirects'][number];

/** Build fails above this (Pages allows 2000 static rules, UNVERIFIED). */
export const MAX_REDIRECT_ROWS = 1900;

export class RedirectsError extends Error {
  constructor(message: string) {
    super(`_redirects: ${message}`);
    this.name = 'RedirectsError';
  }
}

export interface RedirectRow {
  from: string;
  to: string;
  status: 301 | 410;
}

export interface RedirectsOptions {
  /** Origin of the image host (e.g. https://img.mullnyphotos.cz) allowed as an absolute target. */
  imgOrigin: string;
  /** Rows from `snapshot.redirects`. */
  data?: readonly SnapshotRedirect[];
  /** Path of the home OG image; when set, the old preview.jpg redirects there. */
  ogImagePath?: string;
  /** Emit 410 rows (only after Pages support is verified). Default: drop them. */
  emit410?: boolean;
  /** Origin treated as "this site". Default: the production origin. */
  siteOrigin?: string;
}

/** Old category path, new category slug, the original album ids (CONTENT-MAPPING 7.2). */
const OLD_CATEGORIES: ReadonlyArray<readonly [string, string, readonly string[]]> = [
  ['weddings', 'svatby', ['frankovi', 'hradsti', 'sedlakovi', 'suranovi']],
  ['portraits', 'portrety', ['anez', 'lucka', 'lukas', 'mia', 'pati', 'pati2']],
  ['couples', 'parove-foceni', ['pavla_rafael', 'helis_tom', 'lucka_filip']],
];

/** Static part of CONTENT-MAPPING 7.3 (without the image rows). */
export function staticRedirects(ogImagePath?: string): RedirectRow[] {
  const rows: RedirectRow[] = [];
  const add = (from: string, to: string) => rows.push({ from, to, status: 301 });
  add('/index.html', '/');
  add('/home', '/');
  add('/home/', '/');
  for (const [old, slug, ids] of OLD_CATEGORIES) {
    add(`/${old}`, `/${slug}/`);
    add(`/${old}/`, `/${slug}/`);
    for (const id of ids) {
      add(`/${old}/${id}`, `/${slug}/${id}/`);
      add(`/${old}/${id}/`, `/${slug}/${id}/`);
    }
  }
  // T-288: /o-mne/ and /kontakt/ are sections of the home page now (WP-12 section a).
  for (const from of ['/o-mne/', '/o-mne', '/about', '/about/']) add(from, '/#o-mne');
  for (const from of ['/kontakt/', '/kontakt', '/contact', '/contact/']) add(from, '/#kontakt');
  add('/manifest.json', '/manifest.webmanifest');
  if (ogImagePath) add('/fotky_web/site/preview/preview.jpg', ogImagePath);
  return rows;
}

// eslint-disable-next-line no-control-regex
const BAD_CHARS = /[\s\u0000-\u001f\u007f*:#]/;

function checkFrom(from: string): void {
  if (!from.startsWith('/') || from.startsWith('//')) throw new RedirectsError(`source "${show(from)}" must start with a single "/"`);
  if (BAD_CHARS.test(from)) throw new RedirectsError(`source "${show(from)}" contains whitespace, a newline, "*", ":" or "#"`);
}

/** Returns the path of a validated target, plus whether it is local (same-site path). */
function checkTo(to: string, siteOrigin: string, imgOrigin: string): string {
  if (/[\s\u0000-\u001f\u007f]/.test(to)) throw new RedirectsError(`target "${show(to)}" contains whitespace or a newline`);
  if (to.startsWith('/')) {
    if (to.startsWith('//')) throw new RedirectsError(`target "${show(to)}" is protocol-relative`);
    if (to.includes('*')) throw new RedirectsError(`target "${show(to)}" contains "*"`);
    if (to.includes(':')) throw new RedirectsError(`target "${show(to)}" contains ":"`);
    return to.split(/[?#]/)[0]!;
  }
  let url: URL;
  try {
    url = new URL(to);
  } catch {
    throw new RedirectsError(`target "${show(to)}" is neither a path nor an absolute URL`);
  }
  if (url.protocol !== 'https:') throw new RedirectsError(`target "${show(to)}" must use https`);
  if (url.origin !== siteOrigin && url.origin !== imgOrigin) {
    throw new RedirectsError(`target "${show(to)}" points to a foreign host (${url.host})`);
  }
  if (to.includes('*')) throw new RedirectsError(`target "${show(to)}" contains "*"`);
  return url.origin === siteOrigin ? url.pathname : '';
}

const show = (s: string): string => JSON.stringify(s.length > 80 ? `${s.slice(0, 80)}...` : s).slice(1, -1);

/** Validates all rows (static and data) and returns the final list. */
export function collectRedirects(options: RedirectsOptions): RedirectRow[] {
  const siteOrigin = options.siteOrigin ?? SITE_ORIGIN;
  const imgOrigin = new URL(options.imgOrigin).origin;
  const rows = staticRedirects(options.ogImagePath);
  for (const r of options.data ?? []) {
    if (r.status === 410) {
      if (!options.emit410) continue;
      checkFrom(r.from);
      rows.push({ from: r.from, to: '', status: 410 });
      continue;
    }
    if (r.to === null) throw new RedirectsError(`301 row "${show(r.from)}" has no target`);
    rows.push({ from: r.from, to: r.to, status: 301 });
  }
  if (rows.length > MAX_REDIRECT_ROWS) {
    throw new RedirectsError(`${rows.length} rows exceed the limit of ${MAX_REDIRECT_ROWS}`);
  }
  const froms = new Set<string>();
  const targets: Array<{ row: RedirectRow; path: string }> = [];
  for (const row of rows) {
    checkFrom(row.from);
    if (froms.has(row.from)) throw new RedirectsError(`duplicate source "${show(row.from)}"`);
    froms.add(row.from);
    if (row.status === 301) targets.push({ row, path: checkTo(row.to, siteOrigin, imgOrigin) });
  }
  for (const { row, path } of targets) {
    if (path === row.from) throw new RedirectsError(`"${show(row.from)}" redirects to itself`);
    if (path !== '' && froms.has(path)) throw new RedirectsError(`redirect chain: "${show(row.from)}" -> "${show(path)}" is itself redirected`);
  }
  return rows;
}

/** The `_redirects` file text (one `from to status` line per row, trailing newline). */
export function buildRedirects(options: RedirectsOptions): string {
  const lines = collectRedirects(options).map((r) => (r.status === 410 ? `${r.from} - 410` : `${r.from} ${r.to} ${r.status}`));
  return lines.length ? `${lines.join('\n')}\n` : '';
}
