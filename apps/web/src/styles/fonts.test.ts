import { readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = new URL('.', import.meta.url).pathname;
const css = readFileSync(join(here, 'fonts.css'), 'utf8');
const require = createRequire(import.meta.url);
const martelDir = dirname(require.resolve('@fontsource/martel/package.json'));

interface FontFace {
  file: string;
  ranges: Array<[number, number]>;
  display: string;
}

function parseFaces(text: string): FontFace[] {
  const noComments = text.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...noComments.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => {
    const body = m[1]!;
    const file = /url\('@fontsource\/martel\/files\/([^']+)'\)/.exec(body)![1]!;
    const range = /unicode-range:\s*([^;]+);/.exec(body)![1]!;
    const ranges = range.split(',').map((r): [number, number] => {
      const [a, b] = r.trim().replace(/^U\+/i, '').split('-');
      return [parseInt(a!, 16), parseInt(b ?? a!, 16)];
    });
    return { file, ranges, display: /font-display:\s*(\w+)/.exec(body)![1]! };
  });
}

const faces = parseFaces(css);
const covers = (face: FontFace, cp: number) => face.ranges.some(([a, b]) => cp >= a && cp <= b);

describe('Martel font setup', () => {
  it('declares exactly two WOFF2 faces, latin and latin-ext, weight 400, font-display optional', () => {
    expect(faces.map((f) => f.file).sort()).toEqual([
      'martel-latin-400-normal.woff2',
      'martel-latin-ext-400-normal.woff2',
    ]);
    expect(faces.every((f) => f.display === 'optional')).toBe(true);
    expect(css).not.toMatch(/font-weight:\s*(?!400)\d/);
  });

  it('uses no remote URL (no font CDN)', () => {
    expect(css).not.toMatch(/https?:\/\//);
    expect(css).not.toMatch(/googleapis|gstatic/);
  });

  it('the two files together are at most 60 KB', () => {
    const sizes = faces.map((f) => statSync(join(martelDir, 'files', f.file)).size);
    const total = sizes.reduce((a, b) => a + b, 0);
    console.log(`martel woff2 sizes: ${faces.map((f, i) => `${f.file}=${sizes[i]}`).join(', ')}; total=${total} bytes`);
    expect(total).toBeLessThanOrEqual(60 * 1024);
  });

  it('covers every Czech letter (lower and upper case) through the unicode-range of the two files', () => {
    const letters = 'čřěšžůýáéíóúďťňČŘĚŠŽŮÝÁÉÍÓÚĎŤŇ';
    for (const ch of letters) {
      const cp = ch.codePointAt(0)!;
      expect(
        faces.some((f) => covers(f, cp)),
        `${ch} U+${cp.toString(16)}`,
      ).toBe(true);
    }
  });

  it('the Czech letters beyond latin-1 come from latin-ext, the others from latin', () => {
    const latin = faces.find((f) => f.file.includes('latin-400'))!;
    const ext = faces.find((f) => f.file.includes('latin-ext'))!;
    for (const ch of 'čřěšžů') expect(covers(ext, ch.codePointAt(0)!), ch).toBe(true);
    for (const ch of 'ýá') expect(covers(latin, ch.codePointAt(0)!), ch).toBe(true);
  });

  it('the font files exist and are WOFF2 (magic "wOF2")', () => {
    for (const f of faces) {
      const head = readFileSync(join(martelDir, 'files', f.file)).subarray(0, 4).toString('latin1');
      expect(head).toBe('wOF2');
    }
  });
});
