import { describe, expect, it } from 'vitest';
import {
  API_ERROR_CODES,
  CommitRequestSchema,
  DeleteRequestSchema,
  ERROR_STATUS,
  ErrorBodySchema,
  ReserveRequestSchema,
  WORKER_ERROR_CODES,
  apiCodeFromZodError,
  filesMatchPlan,
  jpegKey,
  masterKey,
  ogKey,
  PhotoVariantsSchema,
  planUploadFiles,
  sumBytes,
  variantPlan,
  variantsMatchPlan,
  webpKey,
  type PhotoVariants,
} from './index';

const ID = '11111111-1111-4111-8111-111111111111';
const ALBUM = '22222222-2222-4222-8222-222222222222';

function variantsFor(w: number, h: number): PhotoVariants {
  const p = variantPlan(w, h);
  return {
    master: { ...p.master, bytes: 1000 },
    webp: p.webp.map((e) => ({ tier: e.tier as 480, w: e.w, h: e.h, bytes: 100 })),
    jpeg: { ...p.jpeg, bytes: 500 },
    og: { w: p.og.w, h: p.og.h, bytes: 50 },
  };
}

const filesFor = (w: number, h: number) =>
  planUploadFiles(ID, w, h).map((f) => (f.tier ? { kind: f.kind, tier: f.tier, bytes: 10 } : { kind: f.kind, bytes: 10 }));

describe('planUploadFiles', () => {
  it('gives 8 files for a 3000x2250 master with keys from the shared helpers', () => {
    const files = planUploadFiles(ID, 3000, 2250);
    expect(files.map((f) => f.key)).toEqual([
      masterKey(ID),
      webpKey(ID, 480),
      webpKey(ID, 720),
      webpKey(ID, 960),
      webpKey(ID, 1600),
      webpKey(ID, 2400),
      jpegKey(ID),
      ogKey(ID),
    ]);
    expect(files.map((f) => f.kind)).toEqual(['master', 'webp', 'webp', 'webp', 'webp', 'webp', 'jpeg', 'og']);
    expect(files.filter((f) => f.kind === 'webp').map((f) => f.tier)).toEqual([480, 720, 960, 1600, 2400]);
    expect(files.map((f) => f.contentType)).toEqual([
      'image/jpeg', 'image/webp', 'image/webp', 'image/webp', 'image/webp', 'image/webp', 'image/jpeg', 'image/jpeg',
    ]);
  });

  it('a 719 px master has no 720 file, a 720 px master has exactly 480 and 720', () => {
    const tiers = (w: number) => planUploadFiles(ID, w, Math.round(w * 0.75)).filter((f) => f.kind === 'webp').map((f) => f.tier);
    expect(tiers(719)).toEqual([480]);
    expect(tiers(720)).toEqual([480, 720]);
  });

  it('gives master, one 480 tier, JPEG and OG for 300x200', () => {
    const files = planUploadFiles(ID, 300, 200);
    expect(files.map((f) => `${f.kind}${f.tier ?? ''}`)).toEqual(['master', 'webp480', 'jpeg', 'og']);
  });

  it('rejects an invalid photo id', () => {
    expect(() => planUploadFiles('../x', 300, 200)).toThrow();
  });
});

describe('filesMatchPlan and the reserve schema', () => {
  it('accepts the planned set in any order', () => {
    expect(filesMatchPlan([...filesFor(3000, 2250)].reverse(), 3000, 2250)).toBe(true);
  });

  it('rejects an extra, a missing, a repeated or a wrong-tier file', () => {
    const base = filesFor(3000, 2250);
    expect(filesMatchPlan([...base, { kind: 'og', bytes: 1 }], 3000, 2250)).toBe(false);
    expect(filesMatchPlan(base.slice(1), 3000, 2250)).toBe(false);
    expect(filesMatchPlan(base.map((f, i) => (i === 1 ? base[2]! : f)), 3000, 2250)).toBe(false);
    expect(filesMatchPlan(base.map((f) => (f.kind === 'webp' && f.tier === 2400 ? { ...f, tier: 1600 as const } : f)), 3000, 2250)).toBe(false);
    expect(filesMatchPlan(filesFor(300, 200), 3000, 2250)).toBe(false);
  });

  const req = (over: Record<string, unknown> = {}) => ({
    album_id: ALBUM,
    items: [{ photo_id: ID, width: 3000, height: 2250, files: filesFor(3000, 2250) }],
    ...over,
  });

  it('parses a valid request', () => {
    expect(ReserveRequestSchema.safeParse(req()).success).toBe(true);
  });

  it('maps an extra or missing kind to INVALID_ITEMS', () => {
    const extra = req({ items: [{ photo_id: ID, width: 3000, height: 2250, files: [...filesFor(3000, 2250), { kind: 'og', bytes: 1 }] }] });
    const r = ReserveRequestSchema.safeParse(extra);
    expect(r.success).toBe(false);
    if (!r.success) expect(apiCodeFromZodError(r.error)).toBe('INVALID_ITEMS');
    const missing = req({ items: [{ photo_id: ID, width: 3000, height: 2250, files: filesFor(3000, 2250).slice(1) }] });
    const m = ReserveRequestSchema.safeParse(missing);
    expect(m.success).toBe(false);
    if (!m.success) expect(apiCodeFromZodError(m.error)).toBe('INVALID_ITEMS');
  });

  it('maps duplicate photo ids and a long edge over 3000 to INVALID_ITEMS', () => {
    const item = { photo_id: ID, width: 3000, height: 2250, files: filesFor(3000, 2250) };
    const dup = ReserveRequestSchema.safeParse(req({ items: [item, item] }));
    expect(dup.success).toBe(false);
    if (!dup.success) expect(apiCodeFromZodError(dup.error)).toBe('INVALID_ITEMS');
    const big = ReserveRequestSchema.safeParse(req({ items: [{ photo_id: ID, width: 3001, height: 100, files: filesFor(3001, 100) }] }));
    expect(big.success).toBe(false);
    if (!big.success) expect(apiCodeFromZodError(big.error)).toBe('INVALID_ITEMS');
  });

  it('maps a malformed photo id to INVALID_ID and other shape errors to INVALID_REQUEST', () => {
    const bad = ReserveRequestSchema.safeParse(req({ items: [{ photo_id: 'NOT-A-UUID', width: 300, height: 200, files: filesFor(300, 200) }] }));
    expect(bad.success).toBe(false);
    if (!bad.success) expect(apiCodeFromZodError(bad.error)).toBe('INVALID_ID');
    const shape = ReserveRequestSchema.safeParse({ album_id: ALBUM, items: [], extra: 1 });
    expect(shape.success).toBe(false);
    if (!shape.success) expect(apiCodeFromZodError(shape.error)).toBe('INVALID_REQUEST');
  });
});

describe('variantsMatchPlan and the commit schema', () => {
  it('accepts plan-shaped variants for several sizes', () => {
    for (const [w, h] of [[3000, 2250], [300, 200], [1500, 1000], [2400, 1600]] as const) {
      expect(variantsMatchPlan(variantsFor(w, h), w, h), `${w}x${h}`).toBe(true);
    }
  });

  it('allows 1 px of encoder rounding and nothing more', () => {
    const v = variantsFor(3000, 2250);
    expect(variantsMatchPlan({ ...v, jpeg: { ...v.jpeg, w: v.jpeg.w + 1 } }, 3000, 2250)).toBe(true);
    expect(variantsMatchPlan({ ...v, jpeg: { ...v.jpeg, w: v.jpeg.w + 2 } }, 3000, 2250)).toBe(false);
  });

  it('rejects a wrong tier set', () => {
    const v = variantsFor(3000, 2250);
    expect(variantsMatchPlan({ ...v, webp: v.webp.slice(1) }, 3000, 2250)).toBe(false);
    expect(variantsMatchPlan(variantsFor(300, 200), 3000, 2250)).toBe(false);
    // 1000 px master: a row without the 720 tier fails the strict plan
    const v1000 = variantsFor(1000, 750);
    expect(variantsMatchPlan(v1000, 1000, 750)).toBe(true);
    expect(variantsMatchPlan({ ...v1000, webp: v1000.webp.filter((e) => e.tier !== 720) }, 1000, 750)).toBe(false);
    // a stray 800 tier is refused by the schema, not just by the plan
    const stray = { ...v1000, webp: [...v1000.webp, { tier: 800, w: 800, h: 600, bytes: 1 }] };
    expect(PhotoVariantsSchema.safeParse(stray).success).toBe(false);
    expect(variantsMatchPlan({ ...v, webp: v.webp.map((e) => ({ ...e, tier: 480 as const })) }, 3000, 2250)).toBe(false);
  });

  const commit = (over: Record<string, unknown> = {}) => {
    const variants = variantsFor(3000, 2250);
    return { photo_id: ID, album_id: ALBUM, width: 3000, height: 2250, variants, bytes_total: sumBytes(variants), ...over };
  };

  it('parses a valid commit and rejects bad optional fields', () => {
    expect(CommitRequestSchema.safeParse(commit({ dominant_color: '#aabbcc', alt: 'Nevěsta u okna', legacy_key: 'weddings/abc_1/12.jpg' })).success).toBe(true);
    expect(CommitRequestSchema.safeParse(commit({ dominant_color: 'red' })).success).toBe(false);
    expect(CommitRequestSchema.safeParse(commit({ alt: 'IMG_0001.jpg' })).success).toBe(false);
    expect(CommitRequestSchema.safeParse(commit({ legacy_key: '../weddings/a/1.jpg' })).success).toBe(false);
    expect(CommitRequestSchema.safeParse(commit({ photo_id: 'x' })).success).toBe(false);
  });

  it('rejects variants that do not match the plan', () => {
    const v = variantsFor(3000, 2250);
    const r = CommitRequestSchema.safeParse(commit({ variants: { ...v, webp: v.webp.slice(1) } }));
    expect(r.success).toBe(false);
  });
});

describe('DeleteRequestSchema', () => {
  it('takes 1 to 200 valid ids', () => {
    expect(DeleteRequestSchema.safeParse({ ids: [ID] }).success).toBe(true);
    expect(DeleteRequestSchema.safeParse({ ids: [] }).success).toBe(false);
    expect(DeleteRequestSchema.safeParse({ ids: Array.from({ length: 200 }, () => ID) }).success).toBe(true);
    const tooMany = DeleteRequestSchema.safeParse({ ids: Array.from({ length: 201 }, () => ID) });
    expect(tooMany.success).toBe(false);
    if (!tooMany.success) {
      const code = apiCodeFromZodError(tooMany.error);
      expect(code).toBe('BATCH_TOO_LARGE');
      expect(ERROR_STATUS[code]).toBe(413);
    }
    const bad = DeleteRequestSchema.safeParse({ ids: [ID, 'nope'] });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(apiCodeFromZodError(bad.error)).toBe('INVALID_ID');
  });
});

describe('error codes and statuses', () => {
  it('includes INVALID_ID and INVALID_ITEMS and every database code', () => {
    expect(WORKER_ERROR_CODES).toContain('INVALID_ID');
    expect(WORKER_ERROR_CODES).toContain('INVALID_ITEMS');
    for (const c of API_ERROR_CODES) expect(WORKER_ERROR_CODES).toContain(c);
  });

  it('the status map covers every code and nothing else, with valid HTTP error statuses', () => {
    expect(Object.keys(ERROR_STATUS).sort()).toEqual([...WORKER_ERROR_CODES].sort());
    for (const s of Object.values(ERROR_STATUS)) {
      expect(s).toBeGreaterThanOrEqual(400);
      expect(s).toBeLessThan(600);
    }
    expect(ERROR_STATUS.INVALID_ID).toBe(400);
    expect(ERROR_STATUS.INVALID_ITEMS).toBe(400);
    expect(ERROR_STATUS.STORAGE_FULL).toBe(409);
    expect(ERROR_STATUS.PUBLISH_TOO_SOON).toBe(429);
    expect(ERROR_STATUS.SNAPSHOT_EMPTY).toBe(409);
    expect(ERROR_STATUS.INTERNAL).toBe(500);
    expect(ERROR_STATUS.BATCH_TOO_LARGE).toBe(413);
    expect(WORKER_ERROR_CODES).toContain('SNAPSHOT_EMPTY');
    expect(WORKER_ERROR_CODES).toContain('INTERNAL');
    expect(ErrorBodySchema.safeParse({ error: 'INTERNAL' }).success).toBe(true);
  });

  it('error bodies accept known codes with retryAfter only', () => {
    expect(ErrorBodySchema.safeParse({ error: 'PUBLISH_TOO_SOON', retryAfter: 30 }).success).toBe(true);
    expect(ErrorBodySchema.safeParse({ error: 'NOPE' }).success).toBe(false);
    expect(ErrorBodySchema.safeParse({ error: 'NOT_ADMIN', stack: 'x' }).success).toBe(false);
  });
});
