/**
 * Per-photo storage list (WP-10, T-263): every photo with its stored size (master plus variants), biggest first, an album
 * filter, a per-variant breakdown and the share of the 10 GB provider limit. Verdict data comes from photoQuality (T-260).
 * Pure; the screen shows one page of PAGE_SIZE rows so a catalog of 500+ photos keeps a small DOM.
 */
import { PROVIDER_MAX_BYTES, type AlbumRow, type PhotoRow } from '@mp/shared';
import { photoQuality, type PhotoQuality } from './photoQuality';

export const PAGE_SIZE = 25;

export interface VariantPart {
  /** 'master' | 'webp' | 'jpeg' | 'og' with the tier for WebP, e.g. 'webp-720'. */
  key: string;
  kind: 'master' | 'webp' | 'jpeg' | 'og';
  tier?: number;
  w: number;
  h: number;
  bytes: number;
}

export interface StoragePhotoRow {
  id: string;
  albumId: string;
  albumTitle: string;
  /** Position in the album, as in "Fotka 3". */
  n: number;
  bytes: number;
  /** Share of the 10 GB provider limit, 0..100. */
  sharePercent: number;
  quality: PhotoQuality;
  parts: VariantPart[];
}

export function variantParts(variants: PhotoRow['variants']): VariantPart[] {
  return [
    { key: 'master', kind: 'master', ...variants.master },
    ...variants.webp.map((e) => ({ key: `webp-${e.tier}`, kind: 'webp' as const, tier: e.tier, w: e.w, h: e.h, bytes: e.bytes })),
    { key: 'jpeg', kind: 'jpeg', ...variants.jpeg },
    { key: 'og', kind: 'og', ...variants.og },
  ];
}

/** Rows of all loaded albums (or of one album), biggest first; ties by album title, position, id so the order is stable. */
export function buildPhotoList(
  albums: readonly AlbumRow[],
  photosByAlbum: ReadonlyMap<string, PhotoRow[] | undefined>,
  albumId: string | null,
): StoragePhotoRow[] {
  const rows: StoragePhotoRow[] = [];
  for (const album of albums) {
    if (albumId !== null && album.id !== albumId) continue;
    (photosByAlbum.get(album.id) ?? []).forEach((p, i) => {
      rows.push({
        id: p.id,
        albumId: album.id,
        albumTitle: album.title,
        n: i + 1,
        bytes: p.bytes_total,
        sharePercent: (p.bytes_total / PROVIDER_MAX_BYTES) * 100,
        quality: photoQuality(p),
        parts: variantParts(p.variants),
      });
    });
  }
  rows.sort(
    (a, b) =>
      b.bytes - a.bytes || a.albumTitle.localeCompare(b.albumTitle, 'cs') || a.n - b.n || (a.id < b.id ? -1 : 1),
  );
  return rows;
}

export interface Page<T> {
  rows: T[];
  /** 0-based, clamped into range. */
  page: number;
  pages: number;
  /** 1-based first and last row number shown; 0 when empty. */
  from: number;
  to: number;
  total: number;
}

export function pageOf<T>(all: readonly T[], page: number, size = PAGE_SIZE): Page<T> {
  const pages = Math.max(Math.ceil(all.length / size), 1);
  const p = Math.min(Math.max(page, 0), pages - 1);
  const rows = all.slice(p * size, p * size + size);
  return { rows, page: p, pages, from: rows.length ? p * size + 1 : 0, to: p * size + rows.length, total: all.length };
}

/** "0,03 %", "12 %"; very small shares read "< 0,01 %" so a stored photo is never shown as 0. */
export function formatShare(percent: number): string {
  if (!(percent > 0)) return '0 %';
  if (percent < 0.01) return '< 0,01 %';
  const text = percent < 1 ? percent.toFixed(2) : percent < 10 ? percent.toFixed(1) : String(Math.round(percent));
  return `${text.replace('.', ',')} %`;
}
