import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { findChrome } from './design-check.mjs';
import { detectType, exifHasGps, hasMetadata, injectExif, jpegSegments, judgePhoto, metadataOf } from './admin-encode-lib.mjs';

const SCRIPT = fileURLToPath(new URL('./admin-encode-check.mjs', import.meta.url));

// Smallest JPEG-shaped bytes: SOI, a JFIF APP0, SOS, EOI. Enough for the segment walker.
const jpeg = () => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9]);
const webp = (...chunks) => {
  const body = Buffer.concat(chunks.map((c) => Buffer.concat([Buffer.from(c, 'latin1'), Buffer.from([2, 0, 0, 0, 0, 0])])));
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(body.length + 4, 4);
  head.write('WEBP', 8, 'latin1');
  return Buffer.concat([head, body]);
};

describe('magic bytes and metadata detection', () => {
  it('detects the three formats and rejects the rest', () => {
    expect(detectType(jpeg())).toBe('jpeg');
    expect(detectType(webp('VP8 '))).toBe('webp');
    expect(detectType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0]))).toBe('png');
    expect(detectType(Buffer.from('RIFF....WAVE'))).toBe('unknown');
    expect(detectType(Buffer.alloc(0))).toBe('unknown');
  });

  it('finds no metadata in a clean JPEG and an injected Exif/GPS segment in a dirty one', () => {
    expect(hasMetadata(jpeg())).toBe(false);
    const dirty = injectExif(jpeg());
    const seg = jpegSegments(dirty).find((s) => s.kind === 'exif');
    expect(seg).toBeTruthy();
    expect(exifHasGps(dirty, seg)).toBe(true);
    expect(metadataOf(dirty)).toMatchObject({ exif: true, gps: true });
    expect(detectType(dirty)).toBe('jpeg');
  });

  it('flags EXIF and XMP chunks in a WebP', () => {
    expect(hasMetadata(webp('VP8 '))).toBe(false);
    expect(metadataOf(webp('VP8X', 'EXIF')).exif).toBe(true);
    expect(metadataOf(webp('XMP ')).xmp).toBe(true);
  });
});

describe('judgePhoto', () => {
  const file = (kind, w, h, tier) => ({ kind, tier, type: kind === 'webp' ? 'image/webp' : 'image/jpeg', buf: kind === 'webp' ? webp('VP8 ') : jpeg(), w, h });
  const good = () => ({
    width: 1200,
    height: 800,
    dominantColor: '#808080',
    plan: { master: { w: 1200, h: 800 }, webp: [{ tier: 480, w: 480, h: 320 }], jpeg: { w: 1200, h: 800 }, og: { w: 1200, h: 630 } },
    planFiles: [{ kind: 'master' }, { kind: 'webp', tier: 480 }, { kind: 'jpeg' }, { kind: 'og' }],
    files: [file('master', 1200, 800), file('webp', 480, 320, 480), file('jpeg', 1200, 800), file('og', 1200, 630)],
  });
  const fx = { name: 'x.jpg', displayW: 1200, displayH: 800 };

  it('passes a correct result', () => {
    expect(judgePhoto(fx, good())).toEqual([]);
  });

  it('fails on Exif in the 1600 JPEG (the --break-exif case)', () => {
    const r = good();
    r.files[2].buf = injectExif(r.files[2].buf);
    expect(judgePhoto(fx, r).join()).toMatch(/jpeg carries exif/);
  });

  it('checks phases and byte caps only when the browser entry reports them', () => {
    const r = good();
    r.phases = ['previews', 'detail'];
    r.caps = { webp480: 40_000, master: 5_000_000 };
    expect(judgePhoto({ ...fx, checkCaps: true }, r)).toEqual([]);
    r.files[1].buf = Buffer.concat([webp('VP8 '), Buffer.alloc(41_000)]);
    expect(judgePhoto({ ...fx, checkCaps: true }, r).join()).toMatch(/webp480 is \d+ bytes, above its cap 40000/);
    expect(judgePhoto(fx, r)).toEqual([]); // caps only on flagged fixtures
    r.phases = ['detail'];
    expect(judgePhoto(fx, r).join()).toMatch(/phases detail/);
  });

  it('fails on a wrong file set, wrong magic bytes, upscaling, lost orientation and a bad colour', () => {
    let r = good();
    r.files.pop();
    expect(judgePhoto(fx, r).join()).toMatch(/file set/);
    r = good();
    r.files[1].buf = jpeg();
    expect(judgePhoto(fx, r).join()).toMatch(/webp-480 magic bytes say jpeg/);
    r = good();
    r.files[0].w = 2400;
    r.files[0].h = 1600;
    expect(judgePhoto(fx, r).join()).toMatch(/upscaled/);
    // portrait source (EXIF 6) whose master came out landscape
    expect(judgePhoto({ name: 'p.jpg', displayW: 800, displayH: 1200 }, good()).join()).toMatch(/orientation not applied/);
    r = good();
    r.dominantColor = 'grey';
    expect(judgePhoto(fx, r).join()).toMatch(/not #rrggbb/);
  });
});

describe('admin-encode-check runner', () => {
  it('exits 2 and says SKIPPED without Chrome', () => {
    const r = spawnSync(process.execPath, [SCRIPT], { env: { ...process.env, CHROME_PATH: '', DESIGN_CHECK_NO_FALLBACK: '1' }, encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('SKIPPED: Chrome not found');
  });

  // The real browser run is heavy (bundles, 6000x4000 decode): opt in with ADMIN_ENCODE_BROWSER=1, never during the
  // parallel npm test; `npm run admin-encode-check` is the normal way.
  const browser = findChrome() && process.env.ADMIN_ENCODE_BROWSER === '1';
  it.skipIf(!browser)('passes in Chrome and fails with --break-exif', () => {
    const ok = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
    expect(ok.stdout).toContain('ADMIN_ENCODE: PASS');
    expect(ok.status).toBe(0);
    const broken = spawnSync(process.execPath, [SCRIPT, '--break-exif'], { encoding: 'utf8' });
    expect(broken.status).toBe(1);
  }, 240000);
});
