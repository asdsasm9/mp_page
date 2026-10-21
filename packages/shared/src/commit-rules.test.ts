import { describe, expect, it } from 'vitest';
import {
  checkCommitBytes,
  commitFitsReservation,
  commitQuotaOk,
  hasOversizedFile,
  itemBytes,
  reservationActive,
  totalBytes,
  variantBytes,
} from './commit-rules';
import { variantPlan, sumBytes, type PhotoVariants } from './variants';

function variantsFor(size: number): PhotoVariants {
  const p = variantPlan(1200, 800);
  const d = (s: { w: number; h: number }) => ({ w: s.w, h: s.h, bytes: size });
  return { master: d(p.master), webp: p.webp.map((e) => ({ ...d(e), tier: e.tier as 480 })), jpeg: d(p.jpeg), og: d(p.og) };
}

const MAX = 41_943_040;

describe('commit rules', () => {
  it('expired reservation, commit larger than reserved', () => {
    // The reservation row lingers after expiry (reserve_uploads purges it), so it still binds the commit.
    const v = variantsFor(1000);
    const total = sumBytes(v);
    const reservation = { bytes: total - 1, expiresAtMs: 1_000 };
    expect(reservationActive(reservation, 2_000)).toBe(false);
    const input = { variants: v, bytesTotal: total, actual: variantBytes(v), maxUploadBytes: MAX };
    expect(checkCommitBytes(input)).toBe(true);
    expect(checkCommitBytes({ ...input, reservedBytes: reservation.bytes })).toBe(false);
    expect(checkCommitBytes({ ...input, reservedBytes: total })).toBe(true);
  });

  it('checkCommitBytes refuses missing, wrong-size, oversize and mis-summed objects', () => {
    const v = variantsFor(1000);
    const total = sumBytes(v);
    const base = { variants: v, bytesTotal: total, actual: variantBytes(v), maxUploadBytes: MAX };
    expect(checkCommitBytes(base)).toBe(true);
    expect(checkCommitBytes({ ...base, actual: base.actual.map((b, i) => (i === 1 ? null : b)) })).toBe(false);
    expect(checkCommitBytes({ ...base, actual: base.actual.map((b, i) => (i === 0 ? b - 1 : b)) })).toBe(false);
    expect(checkCommitBytes({ ...base, bytesTotal: total + 1 })).toBe(false);
    expect(checkCommitBytes({ ...base, maxUploadBytes: 999 })).toBe(false);
    expect(checkCommitBytes({ ...base, actual: base.actual.slice(1) })).toBe(false);
  });

  it('commitQuotaOk allows exactly the hard limit', () => {
    expect(commitQuotaOk(5, 3, 2, 10)).toBe(true);
    expect(commitQuotaOk(5, 3, 3, 10)).toBe(false);
  });

  it('small byte helpers', () => {
    expect(itemBytes([{ bytes: 1 }, { bytes: 2 }])).toBe(3);
    expect(hasOversizedFile([{ bytes: 5 }], 5)).toBe(false);
    expect(hasOversizedFile([{ bytes: 6 }], 5)).toBe(true);
    expect(totalBytes([{ bytes_total: 4 }, { bytes_total: 6 }])).toBe(10);
    expect(reservationActive({ expiresAtMs: 10 }, 10)).toBe(false);
    expect(reservationActive({ expiresAtMs: 11 }, 10)).toBe(true);
    expect(commitFitsReservation(10, 10)).toBe(true);
  });
});
