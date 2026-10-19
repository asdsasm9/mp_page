import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { BUDGET, aboveFoldImageUrls, checkWeight, measureFirstLoad, pickCandidate } from './weight';

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function site(html: string, files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'mp-weight-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'p'));
  writeFileSync(join(dir, 'p', 'index.html'), html);
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), body);
  }
  return dir;
}

const picture = (id: string, attrs: string): string =>
  `<picture><source type="image/webp" srcset="https://i/photos/${id}/480.webp 480w, https://i/photos/${id}/960.webp 960w" sizes="100vw"><img src="https://i/photos/${id}/1600.jpg" ${attrs}></picture>`;

describe('pickCandidate', () => {
  it('takes the smallest candidate covering the slot, else the largest', () => {
    expect(pickCandidate('a 480w, b 960w', 390)).toBe('a');
    expect(pickCandidate('a 480w, b 960w', 700)).toBe('b');
    expect(pickCandidate('a 480w, b 960w', 2000)).toBe('b');
  });
});

describe('aboveFoldImageUrls', () => {
  it('lists only eager or high-priority images, through their picture', () => {
    const html = picture('x1', 'loading="eager"') + picture('x2', 'loading="lazy"') + picture('x3', 'fetchpriority="high" loading="eager"');
    expect(aboveFoldImageUrls(html)).toEqual(['https://i/photos/x1/480.webp', 'https://i/photos/x3/480.webp']);
  });
});

describe('measureFirstLoad', () => {
  it('adds gzip html/css/js, fonts and image sizes, and flags unknown images', () => {
    const html =
      '<link rel="stylesheet" href="/a.css"><link rel="preload" as="font" href="/f.woff2"><script src="/a.js"></script>' +
      picture('x1', 'loading="eager"');
    const dir = site(html, { 'a.css': 'body{}'.repeat(100), 'f.woff2': 'f'.repeat(1000), 'a.js': 'let a=1;' });
    const w = measureFirstLoad({ distDir: dir, page: '/p/', imageBytes: () => 20_000 });
    expect(w.fonts).toBe(1000);
    expect(w.fontFiles).toBe(1);
    expect(w.images).toBe(20_000);
    expect(w.css).toBeGreaterThan(0);
    expect(w.total).toBe(w.html + w.css + w.js + w.fonts + w.images);
    expect(checkWeight(w)).toEqual([]);
    expect(measureFirstLoad({ distDir: dir, page: '/p/' }).unknownImages).toHaveLength(1);
  });

  it('reports a page over budget', () => {
    const dir = site(picture('x1', 'loading="eager"'));
    const w = measureFirstLoad({ distDir: dir, page: '/p/', imageBytes: () => BUDGET.images + 1 });
    expect(checkWeight(w).join()).toContain('above-the-fold images');
  });
});
