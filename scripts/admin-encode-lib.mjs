// Pure helpers of admin-encode-check (WP5-20): byte-level format checks and the per-photo assertions.
// No browser, no sharp in here, so the vitest wrapper can test them directly.

/** 'jpeg' | 'png' | 'webp' | 'unknown' from the leading bytes. */
export function detectType(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return 'unknown';
}

/** Metadata segments of a JPEG, walked up to the start of scan: [{ marker, kind, offset, length }]. */
export function jpegSegments(buf) {
  const out = [];
  if (detectType(buf) !== 'jpeg') return out;
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) break;
    const marker = buf[i + 1];
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    if (marker === 0xda || marker === 0xd9) break; // scan data / end of image
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2; // markers without a length
      continue;
    }
    const length = buf.readUInt16BE(i + 2);
    const head = buf.toString('latin1', i + 4, Math.min(i + 4 + 32, i + 2 + length));
    let kind = 'other';
    if (marker === 0xe1 && head.startsWith('Exif\0\0')) kind = 'exif';
    else if (marker === 0xe1 && head.startsWith('http://ns.adobe.com/xap')) kind = 'xmp';
    else if (marker === 0xed) kind = 'iptc';
    else if (marker === 0xfe) kind = 'comment';
    out.push({ marker, kind, offset: i, length });
    i += 2 + length;
  }
  return out;
}

/** Does the TIFF block of an Exif segment carry the GPS IFD pointer (tag 0x8825) in IFD0? */
export function exifHasGps(buf, segment) {
  const t = segment.offset + 4 + 6; // marker, length, "Exif\0\0"
  const end = segment.offset + 2 + segment.length;
  if (t + 8 > end) return false;
  const little = buf.toString('latin1', t, t + 2) === 'II';
  const u16 = (o) => (little ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o) => (little ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const ifd = t + u32(t + 4);
  if (ifd + 2 > end) return false;
  const n = u16(ifd);
  for (let k = 0; k < n; k++) {
    const e = ifd + 2 + k * 12;
    if (e + 12 > end) return false;
    if (u16(e) === 0x8825) return true;
  }
  return false;
}

/** What identifying metadata a file carries: { exif, gps, xmp, iptc } (WebP: EXIF / XMP chunks). */
export function metadataOf(buf) {
  const found = { exif: false, gps: false, xmp: false, iptc: false };
  const type = detectType(buf);
  if (type === 'jpeg') {
    for (const s of jpegSegments(buf)) {
      if (s.kind === 'exif') {
        found.exif = true;
        if (exifHasGps(buf, s)) found.gps = true;
      } else if (s.kind === 'xmp') found.xmp = true;
      else if (s.kind === 'iptc') found.iptc = true;
    }
  } else if (type === 'webp') {
    let i = 12;
    while (i + 8 <= buf.length) {
      const id = buf.toString('latin1', i, i + 4);
      const size = buf.readUInt32LE(i + 4);
      if (id === 'EXIF') found.exif = true;
      if (id === 'XMP ') found.xmp = true;
      i += 8 + size + (size % 2);
    }
  }
  return found;
}

export const hasMetadata = (buf) => {
  const m = metadataOf(buf);
  return m.exif || m.gps || m.xmp || m.iptc;
};

/** A JPEG with a little-endian Exif APP1 segment (orientation 1 + GPS pointer) inserted right after SOI. */
export function injectExif(jpeg) {
  // TIFF: header, IFD0 with 2 entries (Orientation, GPS IFD pointer), GPS IFD with 0 entries.
  const tiff = Buffer.alloc(8 + 2 + 2 * 12 + 4 + 2 + 4);
  tiff.write('II', 0, 'latin1');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(2, 8);
  tiff.writeUInt16LE(0x0112, 10); // Orientation, SHORT
  tiff.writeUInt16LE(3, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt16LE(1, 18);
  tiff.writeUInt16LE(0x8825, 22); // GPS IFD pointer, LONG
  tiff.writeUInt16LE(4, 24);
  tiff.writeUInt32LE(1, 26);
  tiff.writeUInt32LE(8 + 2 + 24 + 4, 30);
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const head = Buffer.from([0xff, 0xe1, 0, 0]);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), head, payload, jpeg.subarray(2)]);
}

const within1 = (a, b) => Math.abs(a - b) <= 1;
const tierKey = (f) => `${f.kind}:${f.tier ?? ''}`;

/**
 * Judges one encoded photo. `fx` is the fixture ({ name, displayW, displayH }); `res` is what the browser returned with
 * every file already decoded to a Buffer and measured: { width, height, dominantColor, plan, planFiles, files }
 * where each file is { kind, tier?, type, buf, w, h }. Returns a list of failure strings (empty = pass).
 */
export function judgePhoto(fx, res) {
  const bad = [];
  const fail = (m) => bad.push(`${fx.name}: ${m}`);

  const wantKeys = res.planFiles.map(tierKey).sort();
  const gotKeys = res.files.map(tierKey).sort();
  if (wantKeys.join(',') !== gotKeys.join(',')) fail(`file set ${gotKeys.join(' ')} != planUploadFiles ${wantKeys.join(' ')}`);

  for (const f of res.files) {
    const label = f.kind + (f.tier ? `-${f.tier}` : '');
    const want = f.kind === 'webp' ? 'webp' : 'jpeg';
    const magic = detectType(f.buf);
    if (magic !== want) fail(`${label} magic bytes say ${magic}, expected ${want}`);
    if (f.type !== (want === 'webp' ? 'image/webp' : 'image/jpeg')) fail(`${label} blob.type is ${f.type}`);
  }

  const find = (kind, tier) => res.files.find((f) => f.kind === kind && (tier === undefined || f.tier === tier));
  const plan = res.plan;
  const sameSize = (f, p, label) => {
    if (!f) return fail(`${label} missing`);
    if (!within1(f.w, p.w) || !within1(f.h, p.h)) fail(`${label} is ${f.w}x${f.h}, plan ${p.w}x${p.h}`);
  };
  sameSize(find('master'), plan.master, 'master');
  for (const p of plan.webp) sameSize(find('webp', p.tier), p, `webp-${p.tier}`);
  sameSize(find('jpeg'), plan.jpeg, 'jpeg');
  sameSize(find('og'), plan.og, 'og');

  const master = find('master');
  if (master) {
    if (Math.max(master.w, master.h) > 3000) fail(`master ${master.w}x${master.h} above 3000 px`);
    if (master.w > fx.displayW + 1 || master.h > fx.displayH + 1) fail(`master ${master.w}x${master.h} upscaled from ${fx.displayW}x${fx.displayH}`);
    const k = Math.min(1, 3000 / Math.max(fx.displayW, fx.displayH));
    if (!within1(master.w, Math.round(fx.displayW * k)) || !within1(master.h, Math.round(fx.displayH * k))) {
      fail(`master ${master.w}x${master.h} is not the oriented source ${fx.displayW}x${fx.displayH} fitted to 3000 px`);
    }
    if (res.width !== master.w || res.height !== master.h) fail(`reported ${res.width}x${res.height} differs from master ${master.w}x${master.h}`);
    if (fx.displayH > fx.displayW !== master.h > master.w) fail('orientation not applied: master aspect differs from the displayed photo');
  }

  for (const kind of ['master', 'jpeg', 'og']) {
    const f = find(kind);
    if (f && hasMetadata(f.buf)) fail(`${kind} carries ${Object.entries(metadataOf(f.buf)).filter(([, v]) => v).map(([k]) => k).join('/')} metadata`);
  }
  for (const f of res.files.filter((x) => x.kind === 'webp')) {
    if (hasMetadata(f.buf)) fail(`webp-${f.tier} carries metadata`);
  }

  if (!/^#[0-9a-f]{6}$/.test(res.dominantColor ?? '')) fail(`dominant colour "${res.dominantColor}" is not #rrggbb`);
  return bad;
}
