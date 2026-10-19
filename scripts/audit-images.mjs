// Audit of every image under public/fotky_web: pixel size and file size per album.
// Usage: node scripts/audit-images.mjs
// Node built-ins only. Parses JPEG (SOF markers), PNG (IHDR) and GIF headers itself.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = join(root, "public", "fotky_web");

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function jpegSize(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    let marker = buf[i + 1];
    while (marker === 0xff) { i++; marker = buf[i + 1]; }
    i += 2;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const len = buf.readUInt16BE(i);
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) return { w: buf.readUInt16BE(i + 5), h: buf.readUInt16BE(i + 3) };
    i += len;
  }
  return null;
}

function pngSize(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function size(file) {
  const buf = readFileSync(file);
  const ext = extname(file).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return jpegSize(buf);
  if (ext === ".png") return pngSize(buf);
  return null;
}

const kb = (b) => (b / 1024).toFixed(0);
const mb = (b) => (b / 1024 / 1024).toFixed(2);

const groups = new Map(); // album dir -> rows
for (const file of walk(base)) {
  if (file.endsWith(".DS_Store")) continue;
  const rel = relative(base, file);
  const dir = dirname(rel);
  const st = statSync(file);
  const dim = size(file);
  if (!groups.has(dir)) groups.set(dir, []);
  groups.get(dir).push({ name: rel.slice(dir.length + 1), bytes: st.size, dim });
}

const numeric = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true });

let totalBytes = 0;
let totalFiles = 0;
const summary = [];
const lines = [];

for (const [dir, rows] of [...groups.entries()].sort()) {
  rows.sort(numeric);
  const bytes = rows.reduce((s, r) => s + r.bytes, 0);
  totalBytes += bytes;
  totalFiles += rows.length;
  const dims = rows.filter((r) => r.dim);
  const maxW = Math.max(...dims.map((r) => r.dim.w));
  const maxH = Math.max(...dims.map((r) => r.dim.h));
  const minW = Math.min(...dims.map((r) => r.dim.w));
  const minH = Math.min(...dims.map((r) => r.dim.h));
  const maxFile = Math.max(...rows.map((r) => r.bytes));
  summary.push(
    `| ${dir} | ${rows.length} | ${mb(bytes)} | ${kb(bytes / rows.length)} | ${kb(maxFile)} | ${minW}x${minH} | ${maxW}x${maxH} |`
  );
  lines.push(`\n### ${dir} (${rows.length} files, ${mb(bytes)} MB)\n`);
  lines.push("| file | width x height | file size (KB) |");
  lines.push("|---|---|---|");
  for (const r of rows) {
    lines.push(`| ${r.name} | ${r.dim ? `${r.dim.w}x${r.dim.h}` : "unknown"} | ${kb(r.bytes)} |`);
  }
}

console.log("## Per-album summary\n");
console.log("| album dir | files | total MB | avg KB | max KB | min px (WxH) | max px (WxH) |");
console.log("|---|---|---|---|---|---|---|");
for (const s of summary) console.log(s);
console.log(`\nTOTAL: ${totalFiles} files, ${mb(totalBytes)} MB`);
console.log("\n## Per-file detail");
for (const l of lines) console.log(l);
