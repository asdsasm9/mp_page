// Live-run report of the legacy migration (plan WP-06 3.7, step 12): migration-report/<stamp>.json and .md.
// Ids, keys, counts and byte sizes only. No credentials, tokens, signed URLs or e-mail addresses: free text
// (error labels) is scrubbed of URLs and e-mail-shaped strings before it is written.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Drift } from './catalog';
import type { CoverReport } from './cover';
import type { UploadReport } from './upload';
import type { RedirectsReport } from './url-history';

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
  /** Catalog drift: existing rows that differ from CONTENT-MAPPING (reported, never overwritten). */
  drift: Drift[];
  /** url_history phase (legacy image redirects); null when it did not run. Paths and counts only: no URLs in report files. */
  redirects: LiveRedirects | null;
  aborted: string | null;
  result: 'OK' | 'INCOMPLETE';
}

export interface LiveRedirects {
  wanted: number;
  inserted: number;
  existing: number;
  /** Rows left unchanged because their target or status differs (old_path and stored status; the URLs are printed on the console only). */
  changed: Array<{ old_path: string; found_status: number }>;
  /** Error code when the redirects phase threw (the counts are then 0); null otherwise. */
  error: string | null;
}

const toLiveRedirects = (r: RedirectsReport | null, error: string | null): LiveRedirects | null =>
  r === null
    ? error === null
      ? null
      : { wanted: 0, inserted: 0, existing: 0, changed: [], error }
    : {
        error: null, wanted: r.wanted, inserted: r.inserted, existing: r.existing, changed: r.changed.map((c) => ({ old_path: c.old_path, found_status: c.found_status })) };

/** Removes URLs, e-mail-shaped strings, bearer tokens and any of the given secret values from free text. */
export const scrub = (s: string, secrets: readonly string[] = []): string => {
  let t = s;
  for (const secret of secrets) if (secret.length > 0) t = t.split(secret).join('[redacted]');
  return t
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[url]')
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[email]')
    .replace(/\bbearer\s+\S+/gi, 'Bearer [redacted]');
};

/** Report for a run whose upload/cover phase threw an unexpected exception: no photo numbers, RESULT: INCOMPLETE. */
export function buildFailedLiveReport(
  alt: 'null' | 'default',
  quotaBefore: number,
  drift: Drift[],
  label: string,
  secrets: readonly string[] = [],
): LiveReport {
  return {
    mode: 'live',
    alt,
    albums: [],
    totals: { found: 0, inserted: 0, skipped: 0, missing: 0, repaired: 0, failed: 0, bytes: 0 },
    quota: { before: quotaBefore, after: null },
    drift: drift.map(scrubDrift),
    redirects: null,
    aborted: `upload phase failed: ${scrub(label, secrets)}`,
    result: 'INCOMPLETE',
  };
}

const scrubDrift = (d: Drift): Drift => ({
  ...d,
  expected: typeof d.expected === 'string' ? scrub(d.expected) : d.expected,
  actual: typeof d.actual === 'string' ? scrub(d.actual) : d.actual,
});

export function buildLiveReport(
  upload: UploadReport,
  covers: CoverReport,
  alt: 'null' | 'default',
  ok: boolean,
  drift: Drift[] = [],
  redirects: RedirectsReport | null = null,
  redirectsError: string | null = null,
): LiveReport {
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
      errors: a.errors.map((e) => scrub(e)),
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
    drift: drift.map(scrubDrift),
    redirects: toLiveRedirects(redirects, redirectsError),
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
  lines.push(`catalog drift: ${r.drift.length}`);
  for (const d of r.drift) lines.push(`DRIFT ${d.kind} ${d.ref} ${d.field}: expected ${JSON.stringify(d.expected)}, found ${JSON.stringify(d.actual)} (left unchanged)`);
  if (r.redirects) {
    const x = r.redirects;
    if (x.error !== null) lines.push(`url_history legacy image redirects: FAILED (${x.error})`);
    else lines.push(`url_history legacy image redirects: wanted ${x.wanted}, inserted ${x.inserted}, already present ${x.existing}, changed ${x.changed.length}`);
    for (const c of x.changed) lines.push(`CHANGED ${c.old_path} (stored status ${c.found_status}, left unchanged)`);
  }
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
