import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  BUDGET,
  DEFAULT_DPR,
  DEFAULT_VIEWPORT,
  aboveFoldImageUrls,
  checkWeight,
  measureFirstLoad,
  neededWidth,
  pickCandidate,
} from './weight';

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

describe('weight model', () => {
  it('needs slot x DPR with the design-check defaults (~663 px)', () => {
    expect(DEFAULT_VIEWPORT).toBe(412);
    expect(DEFAULT_DPR).toBe(1.75);
    expect(neededWidth()).toBeCloseTo(663.3, 1);
    expect(neededWidth(300, 2)).toBe(600);
  });
  it('picks the 720 variant for the default phone', () => {
    const set = 'a 480w, b 720w, c 960w, d 1600w';
    expect(pickCandidate(set, neededWidth())).toBe('b');
    expect(pickCandidate(set, neededWidth(412, 2))).toBe('c');
  });
  it('measureFirstLoad honours slotWidth and dpr', () => {
    const dir = site('<img src="/c.webp" srcset="/a.webp 480w, /b.webp 720w, /c.webp 960w" loading="eager">', {
      'a.webp': 'a'.repeat(10),
      'b.webp': 'b'.repeat(20),
      'c.webp': 'c'.repeat(30),
    });
    expect(measureFirstLoad({ distDir: dir, page: '/p/' }).images).toBe(20);
    expect(measureFirstLoad({ distDir: dir, page: '/p/', slotWidth: 300, dpr: 1 }).images).toBe(10);
    expect(measureFirstLoad({ distDir: dir, page: '/p/', slotWidth: 412, dpr: 2.5 }).images).toBe(30);
  });
});

describe('aboveFoldImageUrls', () => {
  it('lists only eager or high-priority images, through their picture', () => {
    const html = picture('x1', 'loading="eager"') + picture('x2', 'loading="lazy"') + picture('x3', 'fetchpriority="high" loading="eager"');
    expect(aboveFoldImageUrls(html)).toEqual(['https://i/photos/x1/960.webp', 'https://i/photos/x3/960.webp']);
    expect(aboveFoldImageUrls(html, 400)).toEqual(['https://i/photos/x1/480.webp', 'https://i/photos/x3/480.webp']);
  });
});

describe('aboveFoldImageUrls with a bare img srcset', () => {
  it('picks the srcset candidate for the slot, not the src fallback', () => {
    const html = '<img src="/big.webp" srcset="/s.webp 480w, /m.webp 720w, /big.webp 1600w" loading="eager">';
    expect(aboveFoldImageUrls(html)).toEqual(['/m.webp']);
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

  it('allows the four preloaded font files of the WP-12 faces and fails on a fifth (T-274)', () => {
    expect(BUDGET.fontFiles).toBe(4);
    const links = (n: number) =>
      Array.from({ length: n }, (_, i) => `<link rel="preload" as="font" href="/f${i}.woff2">`).join('');
    const files: Record<string, string> = {};
    for (let i = 0; i < 5; i++) files[`f${i}.woff2`] = 'f'.repeat(1000);
    const four = measureFirstLoad({ distDir: site(links(4), files), page: '/p/' });
    expect(four.fontFiles).toBe(4);
    expect(checkWeight(four)).toEqual([]);
    const five = measureFirstLoad({ distDir: site(links(5), files), page: '/p/' });
    expect(checkWeight(five).join()).toContain('font files 5 B is over 4 B');
  });

  it('fails on fonts over the byte budget', () => {
    const dir = site('<link rel="preload" as="font" href="/f.woff2">', { 'f.woff2': 'f'.repeat(BUDGET.fonts + 1) });
    expect(checkWeight(measureFirstLoad({ distDir: dir, page: '/p/' })).join()).toContain('fonts ');
  });

  it('reports a page over budget', () => {
    const dir = site(picture('x1', 'loading="eager"'));
    const w = measureFirstLoad({ distDir: dir, page: '/p/', imageBytes: () => BUDGET.images + 1 });
    expect(checkWeight(w).join()).toContain('above-the-fold images');
  });
});
