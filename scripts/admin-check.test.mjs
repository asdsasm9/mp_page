import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { findChrome } from './design-check.mjs';
import { clsOf, judgeAxe, judgeCheckpoint, judgeCls, judgeConsole, judgeOrigins, judgeOverflow, judgeTargets } from './admin-check-lib.mjs';

const SCRIPT = fileURLToPath(new URL('./admin-check.mjs', import.meta.url));
const PAGE = 'http://127.0.0.1:4000';

describe('target size judge', () => {
  it('fails a 30 px button on the phone and passes 44 px', () => {
    expect(judgeTargets([{ name: 'button "x"', w: 30, h: 30 }], true).join()).toMatch(/30x30 px, under 44/);
    expect(judgeTargets([{ name: 'button "ok"', w: 120, h: 44 }], true)).toEqual([]);
  });
  it('wants only 24 px on a pointer device', () => {
    expect(judgeTargets([{ name: 'a', w: 30, h: 30 }], false)).toEqual([]);
    expect(judgeTargets([{ name: 'a', w: 30, h: 18 }], false)).toHaveLength(1);
  });
  it('counts the narrower side', () => {
    expect(judgeTargets([{ name: 'a "Mia"', w: 28, h: 44 }], true)).toHaveLength(1);
  });
});

describe('origin allowlist judge', () => {
  it('allows the own origin, data: and blob:', () => {
    expect(judgeOrigins([`${PAGE}/`, `${PAGE}/assets/a.js`, 'data:image/svg+xml,x', 'blob:http://127.0.0.1:4000/abc'], PAGE)).toEqual([]);
  });
  it('fails a request to another origin, also another port of localhost', () => {
    expect(judgeOrigins([`${PAGE}/`, 'https://img.example.test/photos/a.webp'], PAGE).join()).toMatch(/another origin: https:\/\/img\.example\.test/);
    expect(judgeOrigins(['http://127.0.0.1:9/admin-check-break'], PAGE)).toHaveLength(1);
  });
});

describe('axe, overflow, console and layout shift judges', () => {
  it('fails serious and critical axe findings only', () => {
    const v = (impact) => ({ id: 'image-alt', impact, nodes: 1, target: 'img' });
    expect(judgeAxe([v('critical')]).join()).toMatch(/axe critical image-alt/);
    expect(judgeAxe([v('serious')])).toHaveLength(1);
    expect(judgeAxe([v('moderate'), v('minor')])).toEqual([]);
  });
  it('fails horizontal overflow', () => {
    expect(judgeOverflow(391, 390)).toHaveLength(1);
    expect(judgeOverflow(390, 390)).toEqual([]);
  });
  it('fails console errors, warnings and page errors, ignores logs', () => {
    expect(judgeConsole([{ type: 'log', text: 'hi' }, { type: 'info', text: 'hi' }])).toEqual([]);
    expect(judgeConsole([{ type: 'error', text: 'x' }, { type: 'warning', text: 'y' }, { type: 'pageerror', text: 'z' }])).toHaveLength(3);
  });
  it('takes the worst session window of layout shifts', () => {
    const entries = [{ value: 0.05, startTime: 100 }, { value: 0.04, startTime: 600 }, { value: 0.2, startTime: 9000 }];
    expect(clsOf(entries)).toBeCloseTo(0.2, 5);
    expect(judgeCls(0.2)).toHaveLength(1);
    expect(judgeCls(0.05)).toEqual([]);
  });
  it('combines the checkpoint judges', () => {
    const m = { axe: [{ id: 'color-contrast', impact: 'serious', nodes: 2, target: 'p' }], scrollWidth: 400, innerWidth: 390, targets: [{ name: 'b', w: 30, h: 30 }] };
    expect(judgeCheckpoint(m, { phone: true })).toHaveLength(3);
    expect(judgeCheckpoint({ axe: [], scrollWidth: 390, innerWidth: 390, targets: [] }, { phone: true })).toEqual([]);
  });
});

describe('admin-check runner', () => {
  it('exits 2 and says SKIPPED without Chrome', () => {
    const r = spawnSync(process.execPath, [SCRIPT], { env: { ...process.env, CHROME_PATH: '', DESIGN_CHECK_NO_FALLBACK: '1' }, encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('SKIPPED: Chrome not found');
  });

  // The real run builds the admin and drives Chrome for about a minute: opt in with ADMIN_CHECK_BROWSER=1, never during
  // the parallel npm test (`npm run admin-check` is the normal way). It reuses the build of the earlier run.
  const browser = findChrome() && process.env.ADMIN_CHECK_BROWSER === '1';
  const run = (flag) => spawnSync(process.execPath, [SCRIPT, '--no-build', '--break', flag, '--out', '.tmp/admin-check/shots-break'], { encoding: 'utf8' });
  it.skipIf(!browser)('passes on the real app', () => {
    const ok = spawnSync(process.execPath, [SCRIPT, '--out', '.tmp/admin-check/shots'], { encoding: 'utf8' });
    expect(ok.stdout).toContain('ADMIN_CHECK: PASS');
    expect(ok.status).toBe(0);
  }, 300000);
  it.skipIf(!browser)('fails with a deliberate 30 px button', () => {
    const r = run('button');
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/30x30 px, under 44/);
  }, 300000);
  it.skipIf(!browser)('fails with a request to another origin', () => {
    const r = run('origin');
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/another origin/);
  }, 300000);
  it.skipIf(!browser)('fails with an axe violation', () => {
    const r = run('axe');
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/axe critical image-alt/);
  }, 300000);
});
