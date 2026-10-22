// make-admin-icons (T-248): renders apps/admin/public/favicon.svg into the fallbacks with sharp.
// Writes favicon-32.png, apple-touch-icon.png (180) and favicon.ico (one 32 px PNG entry). Run: node scripts/make-admin-icons.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const dir = join(resolve(fileURLToPath(new URL('..', import.meta.url))), 'apps', 'admin', 'public');
const svg = readFileSync(join(dir, 'favicon.svg'));
const png = (size) => sharp(svg, { density: Math.ceil((72 * size) / 64) * 2 }).resize(size, size).png().toBuffer();

const p32 = await png(32);
writeFileSync(join(dir, 'favicon-32.png'), p32);
writeFileSync(join(dir, 'apple-touch-icon.png'), await png(180));

const head = Buffer.alloc(22);
head.writeUInt16LE(0, 0); // reserved
head.writeUInt16LE(1, 2); // type icon
head.writeUInt16LE(1, 4); // one image
head[6] = 32; // width
head[7] = 32; // height
head.writeUInt16LE(1, 10); // planes
head.writeUInt16LE(32, 12); // bpp
head.writeUInt32LE(p32.length, 14); // size
head.writeUInt32LE(22, 18); // offset
writeFileSync(join(dir, 'favicon.ico'), Buffer.concat([head, p32]));
console.log('admin icons written to', dir);
