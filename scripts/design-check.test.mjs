import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  EXIT, THRESHOLDS, aggregate, evaluateLighthouse, median, medianSummary, parseArgs, selectRoutes, summarizeLhr, verdictLine,
} from './design-check-lib.mjs';
import { createDistServer, headersFor, listen, parseHeaders } from './serve-dist.mjs';

const good = { performance: 1, accessibility: 1, 'best-practices': 1, seo: 1, lcp: 1200, cls: 0.01, tbt: 0 };

describe('parseArgs', () => {
  it('has defaults', () => {
    expect(parseArgs([])).toMatchObject({ routes: null, runs: 3, out: '.tmp/design-check', help: false });
  });
  it('parses flags', () => {
    expect(parseArgs(['--routes', '/,/kontakt/', '--runs', '1', '--out', 'x'])).toMatchObject({ routes: ['/', '/kontakt/'], runs: 1, out: 'x' });
  });
  it('rejects bad input', () => {
    expect(() => parseArgs(['--nope'])).toThrow(/unknown/);
    expect(() => parseArgs(['--runs', '0'])).toThrow();
    expect(() => parseArgs(['--routes', 'kontakt'])).toThrow();
    expect(() => parseArgs(['--out'])).toThrow(/missing/);
  });
  it('selects routes', () => {
    expect(selectRoutes(null)).toHaveLength(7);
    expect(selectRoutes(['/kontakt/'])[0].name).toBe('contact');
    expect(selectRoutes(['/x/y/'])[0].name).toBe('x-y');
  });
});

describe('evaluation', () => {
  it('median', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(medianSummary([{ lcp: 1 }, { lcp: 5 }, { lcp: 3 }]).lcp).toBe(3);
  });
  it('summarizes a Lighthouse report', () => {
    const lhr = {
      categories: { performance: { score: 0.9 }, accessibility: { score: 1 }, 'best-practices': { score: 1 }, seo: { score: 1 } },
      audits: { 'largest-contentful-paint': { numericValue: 2000 }, 'cumulative-layout-shift': { numericValue: 0 }, 'total-blocking-time': { numericValue: 10 } },
    };
    expect(summarizeLhr(lhr)).toMatchObject({ performance: 0.9, lcp: 2000, cls: 0, tbt: 10 });
  });
  it('flags scores below threshold', () => {
    const p = evaluateLighthouse('/', { ...good, performance: 0.8, lcp: 3000, cls: 0.5 });
    expect(p).toHaveLength(3);
    expect(evaluateLighthouse('/', good, THRESHOLDS)).toEqual([]);
  });
  it('treats missing metrics as failures', () => {
    expect(evaluateLighthouse('/', {}).length).toBe(6);
  });
  it('passes a clean run with exit 0', () => {
    const r = aggregate([{ route: '/', lighthouse: good, axe: [{ impact: 'minor', id: 'x', nodes: [] }], overflow: 0, consoleErrors: [] }]);
    expect(r).toMatchObject({ verdict: 'PASS', exitCode: EXIT.PASS });
  });
  it('fails with exit 1 on a fake Lighthouse report below threshold', () => {
    const r = aggregate([{ route: '/', lighthouse: { ...good, performance: 0.5 }, axe: [], overflow: 0, consoleErrors: [] }]);
    expect(r.exitCode).toBe(1);
    expect(r.failures[0]).toMatch(/performance/);
  });
  it('fails on serious axe, overflow, console errors; light routes skip Lighthouse', () => {
    const r = aggregate([
      { route: '/a', light: true, axe: [{ impact: 'serious', id: 'color-contrast', nodes: [1] }], overflow: 12, consoleErrors: ['CSP blocked'] },
    ]);
    expect(r.failures).toHaveLength(3);
    expect(r.exitCode).toBe(EXIT.FAIL);
  });
  it('fails when nothing was checked', () => {
    expect(aggregate([]).exitCode).toBe(1);
  });
  it('exit codes are distinct', () => {
    expect(new Set(Object.values(EXIT)).size).toBe(3);
    expect(EXIT.SKIPPED).toBe(2);
    expect(verdictLine('SKIPPED')).toBe('DESIGN_CHECK: SKIPPED');
  });
});

describe('headers parser', () => {
  const rules = parseHeaders('/*\n  X-A: 1\n  Cache-Control: no\n\n/_astro/*\n  ! Cache-Control\n  Cache-Control: immutable\n');
  it('parses rules', () => {
    expect(rules).toHaveLength(2);
    expect(rules[1].unset).toEqual(['cache-control']);
  });
  it('applies and detaches headers', () => {
    expect(headersFor(rules, '/x/')).toEqual({ 'x-a': '1', 'cache-control': 'no' });
    expect(headersFor(rules, '/_astro/a.js')).toEqual({ 'x-a': '1', 'cache-control': 'immutable' });
  });
});

describe('serve-dist', () => {
  const dist = mkdtempSync(join(tmpdir(), 'dc-dist-'));
  mkdirSync(join(dist, 'kontakt'));
  writeFileSync(join(dist, 'index.html'), '<h1>home</h1>');
  writeFileSync(join(dist, 'kontakt', 'index.html'), '<h1>k</h1>');
  writeFileSync(join(dist, '404.html'), '<h1>nope</h1>');
  writeFileSync(join(dist, '_headers'), "/*\n  Content-Security-Policy: default-src 'self'\n");
  let running;
  const start = async () => (running ??= await listen(createDistServer(dist)));
  afterAll(() => running?.server.close());

  it('sends CSP on HTML', async () => {
    const { origin } = await start();
    const res = await fetch(`${origin}/kontakt/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toBe("default-src 'self'");
    expect(res.headers.get('content-type')).toContain('text/html');
  });
  it('answers 404 with the 404 page for unknown paths', async () => {
    const { origin } = await start();
    const res = await fetch(`${origin}/nope/`);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('nope');
  });
  it('does not escape the dist root', async () => {
    const { origin } = await start();
    const res = await fetch(`${origin}/..%2f..%2fpackage.json`);
    expect(res.status).toBe(404);
  });
});

describe('runner without Chrome', () => {
  it('prints SKIPPED and exits 2', () => {
    const r = spawnSync(process.execPath, [fileURLToPath(new URL('./design-check.mjs', import.meta.url))], { env: { ...process.env, CHROME_PATH: '' }, encoding: 'utf8' });
    expect(r.stdout).toContain('SKIPPED: Chrome not found');
    expect(r.status).toBe(2);
  });
});
