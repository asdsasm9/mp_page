// Live-run report of the legacy migration (plan WP-06 3.7, step 12): migration-report/<stamp>.json and .md.
// Ids, keys, counts and byte sizes only. No credentials, tokens, signed URLs or e-mail addresses: free text
// (error labels) is scrubbed of URLs and e-mail-shaped strings before it is written.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CoverReport } from './cover';
import type { UploadReport } from './upload';

export interface LiveAlbumReport {
  id: string;
  found: number;
  inserted: number;
  skipped: number;
  missing: number;
  repaired: number;
  failed: number;
  bytes: number;
  coverNumber: number | null;
  coverId: string | null;
  coverStatus: string | null;
  orderOk: boolean | null;
  errors: string[];
}

export interface LiveReport {
  mode: 'live';
  alt: 'null' | 'default';
  albums: LiveAlbumReport[];
  totals: { found: number; inserted: number; skipped: number; missing: number; repaired: number; failed: number; bytes: number };
  quota: { before: number; after: number | null };
  aborted: string | null;
  result: 'OK' | 'INCOMPLETE';
}

const scrub = (s: string): string =>
  s
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[url]')
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[email]');

export function buildLiveReport(upload: UploadReport, covers: CoverReport, alt: 'null' | 'default', ok: boolean): LiveReport {
  const coverById = new Map(covers.albums.map((c) => [c.id, c] as const));
  const albums = upload.albums.map((a): LiveAlbumReport => {
    const c = coverById.get(a.id);
    return {
      id: a.id,
      found: a.found,
      inserted: a.inserted,
      skipped: a.skipped,
      missing: a.missing,
      repaired: a.repaired,
      failed: a.failed,
      bytes: a.bytes,
      coverNumber: c?.number ?? null,
      coverId: c?.coverId ?? null,
      coverStatus: c?.status ?? null,
      orderOk: c?.orderOk ?? null,
      errors: a.errors.map(scrub),
    };
  });
  const sum = (f: (a: LiveAlbumReport) => number) => albums.reduce((s, a) => s + f(a), 0);
  return {
    mode: 'live',
    alt,
    albums,
    totals: {
      found: sum((a) => a.found),
      inserted: upload.inserted,
      skipped: upload.skipped,
      missing: upload.missing,
      repaired: upload.repaired,
      failed: upload.failed,
      bytes: upload.bytes,
    },
    quota: { before: upload.quotaBefore, after: upload.quotaAfter },
    aborted: upload.aborted,
    result: ok ? 'OK' : 'INCOMPLETE',
  };
}

export function formatLiveReportMd(r: LiveReport): string {
  const lines = ['# migrate-legacy live run', '', `alt: ${r.alt}`, ''];
  lines.push('| album | found | inserted | skipped | missing | repaired | failed | bytes | cover | order |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |');
  for (const a of r.albums) {
    const cover = a.coverNumber === null ? '-' : `#${a.coverNumber} ${a.coverId ?? '-'} ${a.coverStatus ?? ''}`.trim();
    const order = a.orderOk === null ? 'n/a' : a.orderOk ? 'OK' : 'WRONG';
    lines.push(`| ${a.id} | ${a.found} | ${a.inserted} | ${a.skipped} | ${a.missing} | ${a.repaired} | ${a.failed} | ${a.bytes} | ${cover} | ${order} |`);
  }
  lines.push('');
  const t = r.totals;
  lines.push(`totals: found ${t.found}, inserted ${t.inserted}, skipped ${t.skipped}, missing ${t.missing}, repaired ${t.repaired}, failed ${t.failed}, bytes ${t.bytes}`);
  lines.push(`quota used before ${r.quota.before}, after ${r.quota.after ?? 'unknown'}`);
  if (r.aborted) lines.push(`ABORTED: ${r.aborted}`);
  for (const a of r.albums) for (const e of a.errors) lines.push(`ERROR ${a.id}: ${e}`);
  lines.push('', `RESULT: ${r.result}`, '');
  return lines.join('\n');
}

/** Writes <dir>/<stamp>.json and <dir>/<stamp>.md. Returns the two paths. */
export function writeLiveReport(report: LiveReport, dir: string, stamp: string): { json: string; md: string } {
  mkdirSync(dir, { recursive: true });
  const out = { json: join(dir, `${stamp}.json`), md: join(dir, `${stamp}.md`) };
  writeFileSync(out.json, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(out.md, formatLiveReportMd(report));
  return out;
}
