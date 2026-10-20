import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CHECKS, runChecks } from './gates.mjs';
import { allowedHosts, checkBudget, resourceHosts, runBudget } from './site-checks.mjs';

const dirs = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** Builds a dist with a home page; `files` are extra files (name -> string or Buffer). */
function dist(body, files = {}, head = '') {
  const dir = mkdtempSync(join(tmpdir(), 'site-budget-'));
  dirs.push(dir);
  const html = `<!DOCTYPE html><html lang="cs"><head><title>T</title>${head}</head><body><h1>x</h1>${body}</body></html>`;
  const all = { 'index.html': html, ...files };
  for (const [name, data] of Object.entries(all)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), data);
  }
  return { pages: [{ path: 'index.html', html }], distDir: dir, imageHost: null };
}

const row = CHECKS.find((c) => c.name === 'budget');

describe('budget gate', () => {
  it('is registered on the site input, SKIP without dist', () => {
    expect(row.input).toBe('site');
    expect(checkBudget(null)).toMatchObject({ status: 'SKIP' });
    expect(runChecks({ files: [], dist: [] }, { checks: [row] }).rows[0].status).toBe('SKIP');
  });

  it('passes a small page and prints each number against its limit', () => {
    const site = dist('', { 'a.js': 'let a=1;' }, '<script src="/a.js"></script>');
    expect(runChecks({ files: [], dist: [], site }, { checks: [row] }).rows[0].status).toBe('PASS');
    const { errors, lines } = runBudget(site);
    expect(errors).toEqual([]);
    expect(lines[0]).toMatch(/html .* \/ 40\.0 KB; css .* \/ 30\.0 KB; js .* \/ 60\.0 KB; fonts 0\/2 files .* \/ 60\.0 KB; images .* \/ 250\.0 KB; lcp image .* \/ 150\.0 KB; total .* \/ 500\.0 KB/);
  });

  it('fails when an extra 100 KB script is added', () => {
    // random bytes do not compress, so 100 KB stays 100 KB gzipped
    const site = dist('', { 'big.js': randomBytes(100 * 1024).toString('base64').slice(0, 100 * 1024) }, '<script src="/big.js"></script>');
    const out = runChecks({ files: [], dist: [], site }, { checks: [row] });
    expect(out.rows[0].status).toBe('FAIL');
    expect(out.exitCode).toBe(1);
    expect(runBudget(site).errors.join()).toContain('js (gzip)');
  });

  it('fails on a third font file and on fonts over 60 KB', () => {
    const font = (n) => `<link rel="preload" as="font" href="/f${n}.woff2">`;
    const bytes = randomBytes(25 * 1024);
    const site = dist('', { 'f1.woff2': bytes, 'f2.woff2': bytes, 'f3.woff2': bytes }, font(1) + font(2) + font(3));
    const msg = runBudget(site).errors.join();
    expect(msg).toContain('font files');
    expect(msg).toContain('fonts 76800 B is over 61440 B');
  });

  it('fails on an eager image over the above-the-fold and LCP limits, ignores lazy ones', () => {
    const img = (name, attrs) => `<img src="/${name}.webp" alt="" width="10" height="10" ${attrs}>`;
    const files = { 'a.webp': randomBytes(160 * 1024), 'b.webp': randomBytes(160 * 1024), 'c.webp': randomBytes(300 * 1024) };
    const site = dist(img('a', 'loading="eager"') + img('b', 'loading="eager"') + img('c', 'loading="lazy"'), files);
    const msg = runBudget(site).errors.join();
    expect(msg).toContain('above-the-fold images');
    expect(msg).toContain('largest above-the-fold image');
    const lazyOnly = dist(img('c', 'loading="lazy"'), files);
    expect(runBudget(lazyOnly).errors).toEqual([]);
  });

  it('picks the 720 candidate of a bare img for the phone slot x DPR, not the 1600 one', () => {
    const files = { 's.webp': randomBytes(10 * 1024), 'm.webp': randomBytes(100 * 1024), 'l.webp': randomBytes(400 * 1024) };
    const site = dist('<img src="/l.webp" srcset="/s.webp 480w, /m.webp 720w, /l.webp 1600w" loading="eager" alt="" width="1" height="1">', files);
    expect(runBudget(site).errors).toEqual([]);
    expect(runBudget(site).lines[0]).toMatch(/lcp image 100\.0 KB \/ 150\.0 KB;/);
  });

  it('fails an LCP image over 150 KB (the 720 variant must fit)', () => {
    const files = { 'm.webp': randomBytes(160 * 1024), 's.webp': randomBytes(10) };
    const site = dist('<img src="/m.webp" srcset="/s.webp 480w, /m.webp 720w" loading="eager" alt="" width="1" height="1">', files);
    expect(runBudget(site).errors.join()).toContain('largest above-the-fold image');
  });

  it('warns, not fails, for an eager image on the image host with unknown size', () => {
    const body = '<img src="https://img.example.cz/photos/x/1600.jpg" loading="eager" alt="" width="1" height="1">';
    const site = { ...dist(body), imageHost: 'img.example.cz' };
    const out = runBudget(site);
    expect(out.errors).toEqual([]);
    expect(out.warnings.join()).toContain('unknown size');
    expect(runBudget({ ...site, imageBytes: () => 20_000 }).warnings).toEqual([]);
    expect(runBudget({ ...site, imageBytes: () => 200_000 }).errors.join()).toContain('largest above-the-fold image');
  });

  it('fails a resource from a non-self host but allows the image host and plain links', () => {
    const head = '<script src="https://cdn.evil.example/x.js"></script><link rel="stylesheet" href="//fonts.example/c.css"><link rel="canonical" href="https://other.example/">';
    const bad = dist('<a href="https://instagram.com/x">i</a>', {}, head);
    const msg = runBudget(bad).errors.join();
    expect(msg).toContain('cdn.evil.example');
    expect(msg).toContain('fonts.example');
    expect(msg).not.toContain('instagram');
    expect(msg).not.toContain('other.example');
    const ok = { ...dist('<img src="https://img.example.cz/p.jpg" alt="" width="1" height="1">'), imageHost: 'img.example.cz' };
    expect(runBudget(ok).errors).toEqual([]);
  });
});

describe('resourceHosts', () => {
  it('reads srcset lists and ignores relative URLs', () => {
    const html = '<img src="/a.jpg" srcset="https://h1.example/a.jpg 1x, /b.jpg 2x"><source srcset="//h2.example/c.webp 480w">';
    expect([...resourceHosts(html)].sort()).toEqual(['h1.example', 'h2.example']);
  });
  it('allows the site itself and the image host', () => {
    expect(allowedHosts('IMG.example.cz')).toEqual(new Set(['www.mullnyphotos.cz', 'img.example.cz']));
  });
});
