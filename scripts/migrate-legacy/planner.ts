// Dry-run planner and report of the legacy migration (plan WP-06 3.3, 3.7, step 6).
// Reads the legacy files, runs the real image pipeline for exact byte sizes, writes only migration-report/.
// No backend, no network. Output is deterministic: two dry-runs print and write identical bytes (timestamp only in file names).
import { mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LEGACY_CATEGORIES } from '../../packages/shared/src/legacy/albums';
import { DETAIL_MIN_LONG_EDGE } from '../../packages/shared/src/photo-quality';
import { processImage } from './image';
import { discoverSources, type DiscoverOptions } from './sources';
import type { MigrateOptions } from './types';

/** Public image host used in the redirect lines when PUBLIC_IMG_BASE_URL is not given. */
export const DEFAULT_PUBLIC_IMG_BASE_URL = 'https://img.mullnyphotos.cz';

export interface AlbumPlan {
  id: string;
  title: string;
  category: string;
  found: number;
  planned: number;
  failed: number;
  /** Planned bytes in R2 (sum of every encoded file). */
  bytes: number;
  sourceBytes: number;
  coverN: number;
  coverId: string;
  orderOk: boolean;
  errors: string[];
  /** Per photo source quality, in file-number order (failed photos have w = h = 0 and are not weak). */
  photoQuality: PhotoSourceQuality[];
  weak: number;
}

export interface PhotoSourceQuality {
  legacyKey: string;
  w: number;
  h: number;
  bytes: number;
  /** Long edge below DETAIL_MIN_LONG_EDGE: re-upload from the original before cutover. */
  weak: boolean;
}

export interface Plan {
  /** DETAIL_MIN_LONG_EDGE used for the weak flag. */
  weakBelow: number;
  /** Photos flagged weak, over all albums. */
  weak: number;
  categories: number;
  albums: AlbumPlan[];
  photos: number;
  planned: number;
  failed: number;
  bytes: number;
  sourceBytes: number;
  missing: string[];
  /** One CONTENT-MAPPING 7.3 line per photo, in album order. */
  redirects: string[];
  result: 'OK' | 'INCOMPLETE';
}

export interface PlanDeps extends DiscoverOptions {
  publicImgBaseUrl?: string;
  /** Concurrent image jobs (default 4). */
  concurrency?: number;
  read?: (path: string) => Promise<Buffer>;
}

export class PlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanError';
  }
}

/** A source whose long edge is below DETAIL_MIN_LONG_EDGE cannot fill the detail tier: re-upload from the original. */
export const isWeakSource = (w: number, h: number): boolean => Math.max(w, h) < DETAIL_MIN_LONG_EDGE;

export function redirectLine(legacyKey: string, photoId: string, base: string): string {
  return `/fotky_web/galleries/${legacyKey} ${base.replace(/\/+$/, '')}/photos/${photoId}/1600.jpg 301`;
}

/** Builds the plan. A non-empty `missing` from discoverSources fails it (PlanError) before any image work. */
export async function planMigration(options: Pick<MigrateOptions, 'album' | 'limitBytes'>, deps: PlanDeps = {}): Promise<Plan> {
  const discovery = discoverSources({ galleriesDir: deps.galleriesDir, album: options.album, exists: deps.exists });
  if (discovery.missing.length > 0) {
    throw new PlanError(`missing ${discovery.missing.length} source file(s): ${discovery.missing.slice(0, 5).join(', ')}${discovery.missing.length > 5 ? ', ...' : ''}`);
  }
  const read = deps.read ?? ((p: string) => readFile(p));
  const base = deps.publicImgBaseUrl || DEFAULT_PUBLIC_IMG_BASE_URL;
  const conc = Math.max(1, deps.concurrency ?? 4);

  const albums: AlbumPlan[] = [];
  const redirects: string[] = [];
  for (const sa of discovery.albums) {
    const results: Array<{ bytes: number; src: number; w: number; h: number; error?: string }> = new Array(sa.photos.length);
    let next = 0;
    const worker = async () => {
      while (next < sa.photos.length) {
        const i = next++;
        const p = sa.photos[i]!;
        try {
          const src = await read(p.path);
          const done = await processImage(src);
          results[i] = { bytes: done.bytesTotal, src: src.length, w: done.source.w, h: done.source.h };
        } catch (e) {
          results[i] = { bytes: 0, src: 0, w: 0, h: 0, error: `${p.legacyKey}: ${(e as Error).message}` };
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(conc, sa.photos.length) }, worker));

    for (const p of sa.photos) redirects.push(redirectLine(p.legacyKey, p.id, base));
    const failed = results.filter((r) => r.error).length;
    const cover = sa.photos[sa.album.mainImgNum - 1];
    const photoQuality = sa.photos.map((p, i): PhotoSourceQuality => {
      const r = results[i]!;
      return { legacyKey: p.legacyKey, w: r.w, h: r.h, bytes: r.src, weak: !r.error && isWeakSource(r.w, r.h) };
    });
    albums.push({
      photoQuality,
      weak: photoQuality.filter((q) => q.weak).length,
      id: sa.album.id,
      title: sa.album.title,
      category: sa.album.categorySlug,
      found: sa.photos.length,
      planned: sa.photos.length - failed,
      failed,
      bytes: results.reduce((s, r) => s + r.bytes, 0),
      sourceBytes: results.reduce((s, r) => s + r.src, 0),
      coverN: sa.album.mainImgNum,
      coverId: cover ? cover.id : '',
      orderOk: sa.photos.every((p, i) => p.n === i + 1),
      errors: results.flatMap((r) => (r.error ? [r.error] : [])),
    });
  }

  const sum = (f: (a: AlbumPlan) => number) => albums.reduce((s, a) => s + f(a), 0);
  const bytes = sum((a) => a.bytes);
  const failed = sum((a) => a.failed);
  const overLimit = options.limitBytes !== null && bytes > options.limitBytes;
  return {
    weakBelow: DETAIL_MIN_LONG_EDGE,
    weak: sum((a) => a.weak),
    categories: options.album ? new Set(albums.map((a) => a.category)).size : LEGACY_CATEGORIES.length,
    albums,
    photos: discovery.total,
    planned: sum((a) => a.planned),
    failed,
    bytes,
    sourceBytes: sum((a) => a.sourceBytes),
    missing: [],
    redirects,
    result: failed === 0 && !overLimit && albums.every((a) => a.orderOk) ? 'OK' : 'INCOMPLETE',
  };
}

const mb = (n: number) => (n / 1048576).toFixed(1);

/** Console text of the report. Deterministic. */
export function formatReport(plan: Plan, options: Pick<MigrateOptions, 'limitBytes'>): string[] {
  const lines = [`migrate-legacy DRY-RUN (no network, nothing uploaded)`];
  lines.push(`categories ${plan.categories}, albums ${plan.albums.length}, photos ${plan.photos}`);
  for (const a of plan.albums) {
    lines.push(
      `${a.id.padEnd(13)} found ${a.found} planned ${a.planned} failed ${a.failed} bytes ${a.bytes} cover #${a.coverN} (${a.coverId}) order ${a.orderOk ? 'OK' : 'BAD'}`,
    );
    for (const e of a.errors) lines.push(`  ERROR ${e}`);
  }
  lines.push(`source quality: long edge below ${plan.weakBelow} px is weak (re-upload from the original before cutover)`);
  lines.push(`weak photos ${plan.weak} of ${plan.photos}`);
  for (const a of plan.albums) {
    for (const q of a.photoQuality) {
      lines.push(`  ${q.legacyKey.padEnd(26)} ${q.w}x${q.h} ${q.bytes} bytes ${q.weak ? 'WEAK' : 'ok'}`);
    }
  }
  lines.push(`planned ${plan.planned} of ${plan.photos}, failed ${plan.failed}`);
  lines.push(`source bytes ${plan.sourceBytes} (${mb(plan.sourceBytes)} MB), planned R2 bytes ${plan.bytes} (${mb(plan.bytes)} MB)`);
  if (options.limitBytes !== null && plan.bytes > options.limitBytes) {
    lines.push(`planned bytes exceed --limit-bytes ${options.limitBytes}`);
  }
  lines.push(`redirect lines ${plan.redirects.length} (a live run inserts these as url_history rows; the dry-run writes nothing)`);
  lines.push(`RESULT: ${plan.result}`);
  return lines;
}

export interface WrittenReport {
  json: string;
  md: string;
  redirects: string;
}

/** Writes migration-report/<stamp>.json, <stamp>.md and legacy-image-redirects.txt. Nothing else is written. */
export function writeReport(plan: Plan, options: Pick<MigrateOptions, 'limitBytes'>, dir: string, stamp: string): WrittenReport {
  mkdirSync(dir, { recursive: true });
  const out: WrittenReport = {
    json: join(dir, `${stamp}.json`),
    md: join(dir, `${stamp}.md`),
    redirects: join(dir, 'legacy-image-redirects.txt'),
  };
  const { redirects, ...rest } = plan;
  writeFileSync(out.json, `${JSON.stringify({ mode: 'dry-run', ...rest, redirectLines: redirects.length }, null, 2)}\n`);
  writeFileSync(out.md, `# migrate-legacy dry-run\n\n${formatReport(plan, options).map((l) => `    ${l}`).join('\n')}\n`);
  writeFileSync(out.redirects, `${redirects.join('\n')}\n`);
  return out;
}
