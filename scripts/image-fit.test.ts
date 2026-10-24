import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs module without types
import { EXIT, coverRenderedWidth, evaluate, formatTable, judgePhoto, parseFitArgs, srcsetWidths } from './image-fit-lib.mjs';

const TIERS = [480, 720, 960, 1600, 2400];

describe('coverRenderedWidth (T-276: only the new crop markup is measured by picture width)', () => {
  const landscape = { boxWidth: 300, boxHeight: 400, naturalWidth: 1500, naturalHeight: 1000 };
  it('a cropped 3:2 photo in a 3/4 box is drawn twice as wide as the box', () => {
    expect(coverRenderedWidth({ isCrop: true, ...landscape })).toBe(600);
  });
  it('legacy markup (no crop class) keeps the box width, even with the same geometry', () => {
    expect(coverRenderedWidth({ isCrop: false, ...landscape })).toBe(300);
  });
  it('a portrait photo in a 4/5 box and a missing natural height never go below the box width', () => {
    expect(coverRenderedWidth({ isCrop: true, boxWidth: 400, boxHeight: 500, naturalWidth: 800, naturalHeight: 1000 })).toBe(400);
    expect(coverRenderedWidth({ isCrop: true, ...landscape, naturalHeight: 0 })).toBe(300);
  });
  it('image-fit.mjs applies it only to img elements with the crop class', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./image-fit.mjs', import.meta.url), 'utf8');
    expect(src).toMatch(/classList\.contains\('crop'\)/);
    // the LCP cover is the documented exception (box-width sizes, WP-12 decision 13)
    expect(src).toMatch(/getAttribute\('fetchpriority'\) !== 'high'/);
  });
});

describe('srcsetWidths', () => {
  it('reads w descriptors in ascending order', () => {
    expect(srcsetWidths('/a/960.webp 960w, /a/480.webp 480w,/a/720.webp 720w')).toEqual([480, 720, 960]);
    expect(srcsetWidths('')).toEqual([]);
  });
});

describe('judgePhoto', () => {
  const j = (naturalWidth: number, renderedWidth: number, dpr: number, tiers = TIERS) => judgePhoto({ naturalWidth, renderedWidth, dpr, tiers });

  it('412 px phone at DPR 1.75 with a 720 px file is fine', () => {
    const r = j(720, 380, 1.75);
    expect(r.status).toBe('ok');
    expect(r.need).toBeCloseTo(665, 0);
  });
  it('flags upscaling blur', () => {
    expect(j(480, 380, 2).status).toBe('blur');
  });
  it('flags heavy overfetch above 1.6 x', () => {
    expect(j(960, 300, 1).status).toBe('heavy');
    expect(j(960, 600, 1).status).toBe('ok');
    expect(j(960, 600, 1).ratio).toBeCloseTo(1.6, 5);
  });
  it('the smallest tier cannot be avoided (floor) and the largest tier is a cap, neither fails', () => {
    expect(j(480, 100, 1)).toMatchObject({ status: 'floor', ok: true });
    expect(j(2400, 1920, 3)).toMatchObject({ status: 'cap', ok: true });
  });
  it('a tier-ladder gap is reported as ladder and does not fail (960 is 2.4% short of 984, 1600 is next)', () => {
    expect(j(1600, 328, 3)).toMatchObject({ status: 'ladder', ok: true });
  });
  it('overfetch fails when a smaller tier would still satisfy the need', () => {
    expect(j(1600, 380, 1)).toMatchObject({ status: 'heavy', ok: false });
    expect(j(960, 300, 1.4)).toMatchObject({ status: 'heavy', ok: false }); // need 420: 480 suffices
  });
  it('a pixel of rounding slack is allowed', () => {
    expect(j(664, 379.6, 1.75).status).toBe('ok');
  });
});

describe('evaluate', () => {
  const good = { route: '/svatby/', width: 412, dpr: 1.75, cls: 0, photos: [{ naturalWidth: 720, renderedWidth: 380, tiers: TIERS }] };

  it('passes a correct measurement and builds a table', () => {
    const r = evaluate([good]);
    expect(r.exitCode).toBe(EXIT.PASS);
    expect(r.rows[0].picked).toEqual([720]);
    expect(formatTable(r.rows)).toContain('/svatby/');
  });
  it('fails on blur, overfetch, CLS and an empty page', () => {
    expect(evaluate([{ ...good, photos: [{ naturalWidth: 480, renderedWidth: 380, tiers: TIERS }] }]).exitCode).toBe(EXIT.FAIL);
    expect(evaluate([{ ...good, photos: [{ naturalWidth: 1600, renderedWidth: 380, tiers: TIERS }] }]).exitCode).toBe(EXIT.FAIL);
    expect(evaluate([{ ...good, cls: 0.02 }]).exitCode).toBe(EXIT.FAIL);
    expect(evaluate([{ ...good, photos: [] }]).exitCode).toBe(EXIT.FAIL);
  });
});

describe('parseFitArgs', () => {
  it('defaults to the plan matrix and rejects bad input', () => {
    const o = parseFitArgs([]);
    expect(o.widths).toEqual([360, 412, 768, 1280, 1920]);
    expect(o.dprs).toEqual([1, 2, 3]);
    expect(o.routes).toEqual(['/', '/svatby/', '/svatby/sedlakovi/']);
    expect(parseFitArgs(['--widths', '412', '--dprs', '1.75']).dprs).toEqual([1.75]);
    expect(() => parseFitArgs(['--routes', 'svatby'])).toThrow();
    expect(() => parseFitArgs(['--bogus'])).toThrow();
  });
});

describe('image-fit.mjs without Chrome', () => {
  const dir = join(__dirname, '..', '.tmp', `image-fit-test-${process.pid}`);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const run = (measurements: unknown) => {
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'm.json');
    writeFileSync(file, JSON.stringify(measurements));
    return spawnSync(process.execPath, [join(__dirname, 'image-fit.mjs'), '--from', file], { encoding: 'utf8' });
  };

  it('exits 0 when every photo fits', () => {
    const r = run([{ route: '/svatby/', width: 412, dpr: 1.75, cls: 0, photos: [{ naturalWidth: 720, renderedWidth: 380, tiers: TIERS }] }]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('IMAGE_FIT: PASS');
  });

  it('exits non-zero for a deliberately wrong sizes (card says 100vw: the 960 file is picked for a 380 px slot at DPR 1)', () => {
    const r = run([{ route: '/svatby/', width: 412, dpr: 1, cls: 0, photos: [{ naturalWidth: 960, renderedWidth: 380, tiers: TIERS }] }]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('IMAGE_FIT: FAIL');
    expect(r.stdout).toContain('heavy');
  });
});
