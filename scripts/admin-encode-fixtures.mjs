// Fixture photos for admin-encode-check (WP5-20), made with sharp into a gitignored folder (.tmp/).
// Every JPEG carries Exif with a GPS position, so a stripped master proves the encoder removes it.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const GPS = {
  GPSLatitudeRef: 'N',
  GPSLatitude: '50/1 5/1 0/1',
  GPSLongitudeRef: 'E',
  GPSLongitude: '14/1 25/1 0/1',
};

/** The fixture list: stored size, orientation, and the size the photo is displayed at (after Exif rotation). */
export const FIXTURES = [
  { name: 'exif-portrait.jpg', type: 'image/jpeg', w: 4000, h: 3000, orientation: 6, displayW: 3000, displayH: 4000 },
  { name: 'photo-6000x4000.jpg', type: 'image/jpeg', w: 6000, h: 4000 },
  { name: 'photo-3000x2000.jpg', type: 'image/jpeg', w: 3000, h: 2000 },
  { name: 'photo-1200x800.jpg', type: 'image/jpeg', w: 1200, h: 800 },
  { name: 'photo-600x400.jpg', type: 'image/jpeg', w: 600, h: 400 },
  { name: 'photo-300x200.jpg', type: 'image/jpeg', w: 300, h: 200 },
  { name: 'alpha.png', type: 'image/png', w: 1500, h: 1000 },
  { name: 'photo.webp', type: 'image/webp', w: 1800, h: 1200 },
].map((f) => ({ orientation: 1, displayW: f.w, displayH: f.h, ...f }));

/** A recognisable picture: sky gradient, a warm block top-left (shows rotation), a ground band. */
function picture(w, h, alpha) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2f6fa8"/><stop offset="1" stop-color="#d9a066"/></linearGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#g)"${alpha ? ' fill-opacity="0.6"' : ''}/>
    <rect x="0" y="0" width="${w * 0.3}" height="${h * 0.3}" fill="#c43c2c"/>
    <circle cx="${w * 0.6}" cy="${h * 0.45}" r="${Math.min(w, h) * 0.2}" fill="#f2e6c8"/>
    <rect x="0" y="${h * 0.8}" width="${w}" height="${h * 0.2}" fill="#3b5d36"/></svg>`;
  return Buffer.from(svg);
}

async function render(f) {
  const base = sharp({ create: { width: f.w, height: f.h, channels: f.type === 'image/png' ? 4 : 3, background: f.type === 'image/png' ? { r: 0, g: 0, b: 0, alpha: 0 } : '#808080' } })
    .composite([{ input: picture(f.w, f.h, f.type === 'image/png') }]);
  if (f.type === 'image/jpeg') {
    // withExif writes the GPS block; withMetadata({ orientation }) sets the Exif Orientation tag of the output.
    return base.jpeg({ quality: 90 }).withExif({ IFD3: GPS }).withMetadata({ orientation: f.orientation }).toBuffer();
  }
  if (f.type === 'image/png') return base.png().toBuffer();
  return base.webp({ quality: 85 }).toBuffer();
}

/** Writes every fixture into `dir` and returns the list with `file` paths. */
export async function generateFixtures(dir) {
  mkdirSync(dir, { recursive: true });
  const out = [];
  for (const f of FIXTURES) {
    const file = join(dir, f.name);
    writeFileSync(file, await render(f));
    out.push({ ...f, file });
  }
  return out;
}
