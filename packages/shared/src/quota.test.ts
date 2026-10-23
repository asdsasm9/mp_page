import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS } from './limits';
import { BatchTooLargeError, canReserve, evaluateQuota, planBatch } from './quota';

const HARD = 9_500_000_000;
const WARN = 8_000_000_000;
const base = { used: 0, reserved: 0, hard: HARD, warn: WARN };
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('evaluateQuota', () => {
  it('ok below warn', () => {
    expect(evaluateQuota({ ...base, used: 7_999_000_000 }).level).toBe('ok');
  });
  it('warn at exactly warn and counts reservations', () => {
    expect(evaluateQuota({ ...base, used: WARN }).level).toBe('warn');
    expect(evaluateQuota({ ...base, used: 7_000_000_000, reserved: 1_000_000_000 }).level).toBe('warn');
  });
  it('full at exactly hard', () => {
    expect(evaluateQuota({ ...base, used: HARD }).level).toBe('full');
    expect(evaluateQuota({ ...base, used: HARD - 1 }).level).toBe('warn');
  });
  it('remaining and percent', () => {
    const e = evaluateQuota({ ...base, used: 4_750_000_000 });
    expect(e.remaining).toBe(4_750_000_000);
    expect(e.percent).toBeCloseTo(50, 10);
    expect(evaluateQuota({ ...base, used: HARD + 5 }).remaining).toBe(0);
  });
});

describe('canReserve', () => {
  const s = { used: HARD - 1000, reserved: 0, hard: HARD };
  it('exact limit allowed, one more refused', () => {
    expect(canReserve(s, 1000)).toBe(true);
    expect(canReserve(s, 1001)).toBe(false);
  });
  it('counts reserved', () => {
    expect(canReserve({ ...s, reserved: 500 }, 500)).toBe(true);
    expect(canReserve({ ...s, reserved: 500 }, 501)).toBe(false);
  });
  it('deleting photos lowers used and re-allows the upload', () => {
    expect(canReserve({ ...s, used: HARD - 500 }, 1000)).toBe(false);
    expect(canReserve({ ...s, used: HARD - 5000 }, 1000)).toBe(true);
  });
});

describe('planBatch', () => {
  it('boundary: exactly at hard accepted, 1 over STORAGE_FULL', () => {
    const st = { ...base, used: HARD - 1000 };
    expect(planBatch(st, [{ photo_id: id(1), bytes: 1000 }]).results[0]).toEqual({ photo_id: id(1), ok: true });
    expect(planBatch(st, [{ photo_id: id(1), bytes: 1001 }]).results[0]).toEqual({
      photo_id: id(1),
      ok: false,
      code: 'STORAGE_FULL',
    });
  });
  it('first-fit: a big refused item then a small accepted one', () => {
    const st = { ...base, used: HARD - 1000 };
    const r = planBatch(st, [
      { photo_id: id(1), bytes: 5000 },
      { photo_id: id(2), bytes: 600 },
      { photo_id: id(3), bytes: 600 },
    ]);
    expect(r.results.map((x) => x.ok)).toEqual([false, true, false]);
    expect(r.reserved_bytes).toBe(600);
  });
  it('two reservations together over the limit: first accepted, second refused', () => {
    const st = { ...base, used: HARD - 1000 };
    const r = planBatch(st, [
      { photo_id: id(1), bytes: 700 },
      { photo_id: id(2), bytes: 700 },
    ]);
    expect(r.results.map((x) => x.code)).toEqual([undefined, 'STORAGE_FULL']);
  });
  it('FILE_TOO_LARGE at 41943041, accepted at exactly 41943040', () => {
    expect(planBatch(base, [{ photo_id: id(1), bytes: DEFAULT_LIMITS.maxUploadBytes + 1 }]).results[0]?.code).toBe(
      'FILE_TOO_LARGE',
    );
    expect(planBatch(base, [{ photo_id: id(1), bytes: DEFAULT_LIMITS.maxUploadBytes }]).results[0]?.ok).toBe(true);
  });
  it('FILE_TOO_LARGE takes precedence over STORAGE_FULL', () => {
    const st = { ...base, used: HARD };
    expect(planBatch(st, [{ photo_id: id(1), bytes: DEFAULT_LIMITS.maxUploadBytes + 1 }]).results[0]?.code).toBe(
      'FILE_TOO_LARGE',
    );
  });
  it('BATCH_TOO_LARGE for 201 items, 200 fine', () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ photo_id: id(i), bytes: 1 }));
    expect(() => planBatch(base, mk(201))).toThrow(BatchTooLargeError);
    expect(() => planBatch(base, mk(201))).toThrow('BATCH_TOO_LARGE');
    expect(planBatch(base, mk(200)).results).toHaveLength(200);
  });
  it('level reflects used + newly reserved; existing reservations count', () => {
    const r = planBatch({ ...base, used: 7_999_999_000, reserved: 0 }, [{ photo_id: id(1), bytes: 1000 }]);
    expect(r.level).toBe('warn');
    expect(r.reserved_bytes).toBe(1000);
    const r2 = planBatch({ ...base, used: HARD - 1000, reserved: 400 }, [{ photo_id: id(1), bytes: 600 }]);
    expect(r2.level).toBe('full');
    expect(r2.reserved_bytes).toBe(1000);
  });
  it('honours custom limits', () => {
    const r = planBatch({ ...base, maxUploadBytes: 10, maxFilesPerBatch: 1 }, [{ photo_id: id(1), bytes: 11 }]);
    expect(r.results[0]?.code).toBe('FILE_TOO_LARGE');
    expect(() =>
      planBatch({ ...base, maxFilesPerBatch: 1 }, [
        { photo_id: id(1), bytes: 1 },
        { photo_id: id(2), bytes: 1 },
      ]),
    ).toThrow(BatchTooLargeError);
  });
  it('returns an empty plan for an empty batch', () => {
    expect(planBatch(base, []).results).toEqual([]);
  });
});

// WP-10: a photo at the new quality is about 3.3 MB, a master can reach its 5 MB cap. No code change needed.
describe('planBatch with WP-10 photo sizes', () => {
  const PHOTO = 3_300_000;
  const MASTER_CAP = 5_000_000;

  it('a 5 MB master is far below the per-file limit and accepted', () => {
    expect(MASTER_CAP).toBeLessThan(DEFAULT_LIMITS.maxUploadBytes);
    const r = planBatch(base, [{ photo_id: id(1), bytes: MASTER_CAP }]);
    expect(r.results[0]).toEqual({ photo_id: id(1), ok: true });
  });

  it('a 5 MB master at exactly the hard limit is accepted, 1 byte over is STORAGE_FULL', () => {
    expect(planBatch({ ...base, used: HARD - MASTER_CAP }, [{ photo_id: id(1), bytes: MASTER_CAP }]).results[0]?.ok).toBe(
      true,
    );
    expect(
      planBatch({ ...base, used: HARD - MASTER_CAP + 1 }, [{ photo_id: id(1), bytes: MASTER_CAP }]).results[0]?.code,
    ).toBe('STORAGE_FULL');
  });

  it('fits 2878 photos of 3.3 MB under the 9.5 GB hard limit and refuses the 2879th', () => {
    const fit = Math.floor(HARD / PHOTO);
    expect(fit).toBe(2878);
    const st = { ...base, used: (fit - 1) * PHOTO };
    expect(planBatch(st, [{ photo_id: id(1), bytes: PHOTO }]).results[0]?.ok).toBe(true);
    expect(planBatch({ ...base, used: fit * PHOTO }, [{ photo_id: id(1), bytes: PHOTO }]).results[0]?.code).toBe(
      'STORAGE_FULL',
    );
  });

  it('the 8 GB warning starts after about 2424 photos of 3.3 MB', () => {
    const n = Math.ceil(WARN / PHOTO);
    expect(n).toBe(2425);
    expect(evaluateQuota({ ...base, used: (n - 1) * PHOTO }).level).toBe('ok');
    expect(evaluateQuota({ ...base, used: n * PHOTO }).level).toBe('warn');
  });

  it('a 200-file batch of 3.3 MB photos (660 MB) is accepted on an empty store', () => {
    const items = Array.from({ length: 200 }, (_, i) => ({ photo_id: id(i), bytes: PHOTO }));
    const r = planBatch(base, items);
    expect(r.results.every((x) => x.ok)).toBe(true);
    expect(r.reserved_bytes).toBe(200 * PHOTO);
    expect(r.level).toBe('ok');
  });
});
