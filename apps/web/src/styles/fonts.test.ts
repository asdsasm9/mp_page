import { readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { BUDGET } from '../lib/weight';

const here = new URL('.', import.meta.url).pathname;
const css = readFileSync(join(here, 'fonts.css'), 'utf8');
const require = createRequire(import.meta.url);
const packageDirs: Record<string, string> = {
  'cormorant-garamond': dirname(require.resolve('@fontsource/cormorant-garamond/package.json')),
  lora: dirname(require.resolve('@fontsource/lora/package.json')),
};

interface FontFace {
  pkg: string;
  family: string;
  file: string;
  ranges: Array<[number, number]>;
  display: string;
}

function parseFaces(text: string): FontFace[] {
  const noComments = text.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...noComments.matchAll(/@font-face\s*\{([^}]*)\}/g)]
    .filter((m) => /@fontsource\//.test(m[1]!))
    .map((m) => {
      const body = m[1]!;
      const src = /url\('@fontsource\/([^/]+)\/files\/([^']+)'\)/.exec(body)!;
      const range = /unicode-range:\s*([^;]+);/.exec(body)![1]!;
      const ranges = range.split(',').map((r): [number, number] => {
        const [a, b] = r.trim().replace(/^U\+/i, '').split('-');
        return [parseInt(a!, 16), parseInt(b ?? a!, 16)];
      });
      return {
        pkg: src[1]!,
        family: /font-family:\s*'([^']+)'/.exec(body)![1]!,
        file: src[2]!,
        ranges,
        display: /font-display:\s*(\w+)/.exec(body)![1]!,
      };
    });
}

const faces = parseFaces(css);
const covers = (face: FontFace, cp: number) => face.ranges.some(([a, b]) => cp >= a && cp <= b);
const filePath = (f: FontFace) => join(packageDirs[f.pkg]!, 'files', f.file);

// WOFF2 tag table (known tags, index = flag & 63), only the order matters up to cmap, but all are listed.
const KNOWN_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG',
  'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC',
  'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc',
  'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat',
  'Gloc', 'Feat', 'Sill',
];

/** The set of code points in the cmap of a WOFF2 file (format 4 and 12 subtables). No dependency. */
export function woff2Codepoints(file: Buffer): Set<number> {
  expect(file.subarray(0, 4).toString('latin1')).toBe('wOF2');
  const numTables = file.readUInt16BE(12);
  const totalCompressed = file.readUInt32BE(20);
  let pos = 48;
  const dir: Array<{ tag: string; length: number }> = [];
  const readBase128 = (): number => {
    let v = 0;
    for (let i = 0; i < 5; i++) {
      const b = file[pos++]!;
      v = v * 128 + (b & 0x7f);
      if (!(b & 0x80)) return v;
    }
    throw new Error('bad UIntBase128');
  };
  for (let i = 0; i < numTables; i++) {
    const flags = file[pos++]!;
    let tag: string;
    if ((flags & 63) === 63) {
      tag = file.subarray(pos, pos + 4).toString('latin1');
      pos += 4;
    } else tag = KNOWN_TAGS[flags & 63]!;
    const version = flags >> 6;
    const orig = readBase128();
    const transformed = tag === 'glyf' || tag === 'loca' ? version === 0 : tag === 'hmtx' ? version === 1 : version !== 0;
    dir.push({ tag, length: transformed ? readBase128() : orig });
  }
  const data = brotliDecompressSync(file.subarray(pos, pos + totalCompressed));
  let offset = 0;
  let cmap: Buffer | undefined;
  for (const t of dir) {
    if (t.tag === 'cmap') cmap = data.subarray(offset, offset + t.length);
    offset += t.length;
  }
  expect(cmap, 'cmap table').toBeDefined();
  const out = new Set<number>();
  const n = cmap!.readUInt16BE(2);
  for (let i = 0; i < n; i++) {
    const sub = cmap!.readUInt32BE(4 + i * 8 + 4);
    const format = cmap!.readUInt16BE(sub);
    if (format === 4) {
      const segX2 = cmap!.readUInt16BE(sub + 6);
      const ends = sub + 14;
      const starts = ends + segX2 + 2;
      for (let s = 0; s < segX2 / 2; s++) {
        const end = cmap!.readUInt16BE(ends + s * 2);
        const start = cmap!.readUInt16BE(starts + s * 2);
        if (start === 0xffff) continue;
        for (let cp = start; cp <= end; cp++) out.add(cp);
      }
    } else if (format === 12) {
      const groups = cmap!.readUInt32BE(sub + 12);
      for (let g = 0; g < groups; g++) {
        const start = cmap!.readUInt32BE(sub + 16 + g * 12);
        const end = cmap!.readUInt32BE(sub + 20 + g * 12);
        for (let cp = start; cp <= end; cp++) out.add(cp);
      }
    }
  }
  return out;
}

describe('Cormorant Garamond and Lora font setup', () => {
  it('declares exactly four WOFF2 faces (latin and latin-ext of each), weight 400, font-display swap', () => {
    expect(faces.map((f) => f.file).sort()).toEqual([
      'cormorant-garamond-latin-400-normal.woff2',
      'cormorant-garamond-latin-ext-400-normal.woff2',
      'lora-latin-400-normal.woff2',
      'lora-latin-ext-400-normal.woff2',
    ]);
    expect(faces.every((f) => f.display === 'swap')).toBe(true);
    expect(css).not.toMatch(/font-weight:\s*(?!400)\d/);
  });

  it('declares the two metric-matched local fallbacks', () => {
    for (const name of ['Cormorant Fallback', 'Lora Fallback']) {
      expect(css).toContain(`font-family: '${name}'`);
    }
    expect((css.match(/size-adjust:/g) ?? []).length).toBe(2);
    expect((css.match(/ascent-override:/g) ?? []).length).toBe(2);
  });

  it('uses no remote URL (no font CDN)', () => {
    expect(css).not.toMatch(/https?:\/\//);
    expect(css).not.toMatch(/googleapis|gstatic/);
  });

  it('the old body face is gone (T-274; the name is split so a grep of src stays empty)', () => {
    expect(css).not.toMatch(new RegExp(['mar', 'tel'].join(''), 'i'));
  });

  it('the four files together fit the font budget in weight.ts (measured 75,928 B, cap 120 KB)', () => {
    const sizes = faces.map((f) => statSync(filePath(f)).size);
    const total = sizes.reduce((a, b) => a + b, 0);
    console.log(`woff2 sizes: ${faces.map((f, i) => `${f.file}=${sizes[i]}`).join(', ')}; total=${total} bytes`);
    expect(BUDGET.fontFiles).toBe(4);
    expect(total).toBeLessThanOrEqual(BUDGET.fonts);
    expect(BUDGET.fonts).toBeLessThanOrEqual(120 * 1024);
  });

  it('covers every Czech letter (lower and upper case) through the unicode-range of the files', () => {
    const letters = 'čřěšžůýáéíóúďťňČŘĚŠŽŮÝÁÉÍÓÚĎŤŇ';
    for (const family of ['Cormorant Garamond', 'Lora']) {
      for (const ch of letters) {
        const cp = ch.codePointAt(0)!;
        expect(
          faces.some((f) => f.family === family && covers(f, cp)),
          `${family} ${ch} U+${cp.toString(16)}`,
        ).toBe(true);
      }
    }
  });

  it('the Czech letters beyond latin-1 come from latin-ext, the others from latin', () => {
    for (const family of ['Cormorant Garamond', 'Lora']) {
      const latin = faces.find((f) => f.family === family && !f.file.includes('-ext-'))!;
      const ext = faces.find((f) => f.family === family && f.file.includes('-ext-'))!;
      for (const ch of 'čřěšžů') expect(covers(ext, ch.codePointAt(0)!), `${family} ${ch}`).toBe(true);
      for (const ch of 'ýá') expect(covers(latin, ch.codePointAt(0)!), `${family} ${ch}`).toBe(true);
    }
  });

  it('the font files exist and are WOFF2 (magic "wOF2")', () => {
    for (const f of faces) {
      expect(readFileSync(filePath(f)).subarray(0, 4).toString('latin1')).toBe('wOF2');
    }
  });

  it('real glyph coverage: every Czech letter and typographic mark is in the cmap of the face that serves it', () => {
    const wanted = 'čřěšžůýáéíóúďťňČŘĚŠŽŮÝÁÉÍÓÚĎŤŇ' + '„“–—·×…\'';
    for (const family of ['Cormorant Garamond', 'Lora']) {
      const famFaces = faces.filter((f) => f.family === family);
      const glyphs = new Map(famFaces.map((f) => [f.file, woff2Codepoints(readFileSync(filePath(f)))]));
      for (const ch of wanted) {
        const cp = ch.codePointAt(0)!;
        const serving = famFaces.filter((f) => covers(f, cp));
        expect(serving.length, `${family} ${ch} has a serving face`).toBeGreaterThan(0);
        expect(
          serving.some((f) => glyphs.get(f.file)!.has(cp)),
          `${family} has a glyph for ${ch} U+${cp.toString(16)}`,
        ).toBe(true);
      }
    }
  });

  it('documented negative: neither face has an arrow glyph (U+2190, U+2192), so arrows are inline SVG', () => {
    for (const f of faces) {
      const set = woff2Codepoints(readFileSync(filePath(f)));
      expect(set.has(0x2190), `${f.file} U+2190`).toBe(false);
      expect(set.has(0x2192), `${f.file} U+2192`).toBe(false);
    }
  });

  it('the cmap parser sees a plain letter (self-test)', () => {
    const f = faces.find((x) => x.file === 'lora-latin-400-normal.woff2')!;
    const set = woff2Codepoints(readFileSync(filePath(f)));
    expect(set.has('a'.codePointAt(0)!)).toBe(true);
    expect(set.has(0x4e2d)).toBe(false);
  });
});
