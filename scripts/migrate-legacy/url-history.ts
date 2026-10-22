// Legacy image redirects phase of the live migration (T-200, decision D-13 answer A).
// After the photos exist: one url_history row (301) per migrated photo, from /fotky_web/galleries/<legacy_key>
// to the absolute image-host URL <PUBLIC_IMG_BASE_URL>/photos/<photoId>/1600.jpg. apps/web builds `_redirects`
// from these rows (snapshot.redirects). Idempotent: existing rows are never touched; a row whose target or
// status differs is reported (changed) and left as it is.
import { LEGACY_ALBUMS } from '../../packages/shared/src/legacy/albums';
import type { MigrationBackend, UrlHistoryInput, UrlHistoryResult } from './backend';
import { DEFAULT_PUBLIC_IMG_BASE_URL } from './planner';
import type { MigrateOptions } from './types';

export const LEGACY_IMAGE_PATH_PREFIX = '/fotky_web/galleries/';

export interface RedirectsReport extends UrlHistoryResult {
  /** Rows wanted for the photos that exist in scope. */
  wanted: number;
  base: string;
}

export function legacyRedirectRow(legacyKey: string, photoId: string, base: string): UrlHistoryInput {
  return { old_path: `${LEGACY_IMAGE_PATH_PREFIX}${legacyKey}`, target: `${base.replace(/\/+$/, '')}/photos/${photoId}/1600.jpg` };
}

/** Inserts the redirect rows for every migrated legacy photo in scope. Run after the photos are registered. */
export async function syncRedirects(
  backend: MigrationBackend,
  options: Pick<MigrateOptions, 'album'>,
  publicImgBaseUrl: string | undefined,
): Promise<RedirectsReport> {
  const base = (publicImgBaseUrl || DEFAULT_PUBLIC_IMG_BASE_URL).replace(/\/+$/, '');
  const prefixes = LEGACY_ALBUMS.filter((a) => options.album === null || a.id === options.album).map((a) => `${a.legacyCategory}/${a.id}/`);
  const rows = (await backend.listPhotosByLegacyKey())
    .filter((p) => p.legacy_key !== null && prefixes.some((x) => p.legacy_key!.startsWith(x)))
    .map((p) => legacyRedirectRow(p.legacy_key!, p.id, base))
    .sort((a, b) => (a.old_path < b.old_path ? -1 : 1));
  const result = await backend.addUrlHistory(rows);
  return { ...result, wanted: rows.length, base };
}

/** Every wanted row exists as wanted. A changed row means the legacy URL points elsewhere than the migrated photo: INCOMPLETE. */
export const redirectsComplete = (r: RedirectsReport): boolean => r.changed.length === 0 && r.inserted + r.existing === r.wanted;

/** Console lines show hosts and paths without the scheme, like the other output (no URL-shaped strings). */
const bare = (s: string | null): string => (s === null ? 'null' : s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, ''));

export function formatRedirects(r: RedirectsReport): string[] {
  const lines = [`url_history: legacy image redirects wanted ${r.wanted}, inserted ${r.inserted}, already present ${r.existing}, changed ${r.changed.length} (target host ${bare(r.base)})`];
  for (const c of r.changed) {
    lines.push(`  CHANGED ${c.old_path}: wanted ${bare(c.wanted_target)}, found ${bare(c.found_target)} status ${c.found_status} (left unchanged)`);
  }
  return lines;
}
