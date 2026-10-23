// Offline photo-quality measurement (WP-10 step 1, T-265). Nothing is uploaded, no network, no browser.
// Reads the legacy gallery JPEGs (legacy/fotky_web/galleries, read-only) and, when present, the photographer's
// originals in samples/originals/ (gitignored), re-encodes them with sharp/libwebp at several qualities with and
// without an unsharp mask, compares each result to a Lanczos3 reference of the same size by luma SSIM and writes
// docs/PHOTO-QUALITY-MEASUREMENTS.md. The report is deterministic: no dates, no timings, sorted input.
// Usage: npm run photo-quality   (writes the report; contact sheets go to samples/contact-sheets/, gitignored)
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { variantPlan } from '../packages/shared/src/variants';
import { lumaSsim } from './photo-quality/ssim';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const GALLERIES = join(ROOT, 'legacy', 'fotky_web', 'galleries');
const ORIGINALS = join(ROOT, 'samples', 'originals');
const SHEETS = join(ROOT, 'samples', 'contact-sheets');
const REPORT = join(ROOT, 'docs', 'PHOTO-QUALITY-MEASUREMENTS.md');
const MAX_LEGACY_SAMPLES = 24;
const UNSHARP_SIGMA = 0.6;

interface Spec {
  id: string;
  label: string;
  kind: 'webp' | 'jpeg' | 'master';
  /** Plan section 3.1 numbers. */
  start: number;
  cap: number;
  floor: number;
  sharpen: number;
  estLow: number;
  estHigh: number;
  qualities: number[];
}

const KB = 1024;
const WEBP_QS = [0.6, 0.65, 0.7, 0.72, 0.74, 0.8, 0.85, 0.9];
const JPEG_QS = [0.75, 0.8, 0.85, 0.9, 0.95];

const SPECS: Spec[] = [
  { id: 'w480', label: 'WebP 480', kind: 'webp', start: 0.74, cap: 40 * KB, floor: 0.6, sharpen: 0.45, estLow: 20 * KB, estHigh: 35 * KB, qualities: WEBP_QS },
  { id: 'w720', label: 'WebP 720', kind: 'webp', start: 0.74, cap: 80 * KB, floor: 0.6, sharpen: 0.45, estLow: 40 * KB, estHigh: 65 * KB, qualities: WEBP_QS },
  { id: 'w960', label: 'WebP 960', kind: 'webp', start: 0.72, cap: 110 * KB, floor: 0.6, sharpen: 0.45, estLow: 65 * KB, estHigh: 100 * KB, qualities: WEBP_QS },
  { id: 'w1600', label: 'WebP 1600', kind: 'webp', start: 0.8, cap: 320 * KB, floor: 0.7, sharpen: 0.25, estLow: 170 * KB, estHigh: 260 * KB, qualities: WEBP_QS },
  { id: 'w2400', label: 'WebP 2400', kind: 'webp', start: 0.8, cap: 700 * KB, floor: 0.7, sharpen: 0.12, estLow: 380 * KB, estHigh: 560 * KB, qualities: WEBP_QS },
  { id: 'jpeg', label: 'JPEG 1600', kind: 'jpeg', start: 0.85, cap: 450 * KB, floor: 0.75, sharpen: 0, estLow: 300 * KB, estHigh: 400 * KB, qualities: JPEG_QS },
  { id: 'og', label: 'OG 1200x630', kind: 'jpeg', start: 0.82, cap: 160 * KB, floor: 0.7, sharpen: 0.25, estLow: 80 * KB, estHigh: 130 * KB, qualities: [0.7, 0.75, 0.82, 0.9] },
  { id: 'master', label: 'Master (<=3000 px)', kind: 'master', start: 0.9, cap: 5 * 1024 * KB, floor: 0.8, sharpen: 0, estLow: 1.6 * 1024 * KB, estHigh: 2.6 * 1024 * KB, qualities: [0.8, 0.85, 0.88, 0.9, 0.95] },
];

interface Raw {
  data: Buffer;
  width: number;
  height: number;
}

interface Sample {
  name: string;
  /** True for the legacy gallery files (already lossy, about 1480 px): results are provisional. */
  legacy: boolean;
  file: Buffer;
}

export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/** Nearest-rank percentile, p in (0, 1]. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))] as number;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(jpe?g)$/i.test(e.name)) out.push(p);
  }
  return out;
}

export function loadSamples(): Sample[] {
  const samples: Sample[] = [];
  if (existsSync(ORIGINALS)) {
    for (const f of walk(ORIGINALS)) samples.push({ name: `originals/${relative(ORIGINALS, f)}`, legacy: false, file: readFileSync(f) });
  }
  if (existsSync(GALLERIES)) {
    const all = walk(GALLERIES);
    const step = Math.max(1, Math.ceil(all.length / MAX_LEGACY_SAMPLES));
    for (let i = 0; i < all.length; i += step) {
      const f = all[i] as string;
      samples.push({ name: `legacy/${relative(GALLERIES, f)}`, legacy: true, file: readFileSync(f) });
    }
  }
  return samples;
}

async function decode(buf: Buffer): Promise<Raw> {
  const { data, info } = await sharp(buf).rotate().removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

async function lumaOf(img: Raw | Buffer): Promise<Uint8Array> {
  const pipe = Buffer.isBuffer(img) ? sharp(img) : sharp(img.data, { raw: { width: img.width, height: img.height, channels: 3 } });
  const { data } = await pipe.greyscale().raw().toBuffer({ resolveWithObject: true });
  return data;
}

async function resizeRaw(src: Raw, w: number, h: number, kernel: 'lanczos3' | 'linear'): Promise<Raw> {
  const { data, info } = await sharp(src.data, { raw: { width: src.width, height: src.height, channels: 3 } })
    .resize(w, h, { fit: 'fill', kernel })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** The reference: one direct Lanczos3 resize from the source pixels. */
export const reference = (src: Raw, w: number, h: number) => (src.width === w && src.height === h ? Promise.resolve(src) : resizeRaw(src, w, h, 'lanczos3'));

/** Browser-canvas-like downscale: halving steps with a bilinear filter, last step at most 2x (what the admin does). */
export async function halving(src: Raw, w: number, h: number): Promise<Raw> {
  let cur = src;
  while (cur.width / 2 >= w && cur.height / 2 >= h) {
    cur = await resizeRaw(cur, Math.max(1, Math.round(cur.width / 2)), Math.max(1, Math.round(cur.height / 2)), 'linear');
  }
  return cur.width === w && cur.height === h ? cur : resizeRaw(cur, w, h, 'linear');
}

/** Unsharp mask on luma: every channel gets amount * (luma - blurred luma). amount 0 returns the input. */
export async function unsharp(img: Raw, amount: number): Promise<Raw> {
  if (amount === 0) return img;
  const blurred = await sharp(img.data, { raw: { width: img.width, height: img.height, channels: 3 } }).blur(UNSHARP_SIGMA).raw().toBuffer();
  const out = Buffer.allocUnsafe(img.data.length);
  for (let i = 0; i < img.data.length; i += 3) {
    const r = img.data[i] as number;
    const g = img.data[i + 1] as number;
    const b = img.data[i + 2] as number;
    const d = amount * (0.299 * (r - (blurred[i] as number)) + 0.587 * (g - (blurred[i + 1] as number)) + 0.114 * (b - (blurred[i + 2] as number)));
    out[i] = Math.max(0, Math.min(255, Math.round(r + d)));
    out[i + 1] = Math.max(0, Math.min(255, Math.round(g + d)));
    out[i + 2] = Math.max(0, Math.min(255, Math.round(b + d)));
  }
  return { data: out, width: img.width, height: img.height };
}

async function encode(img: Raw, spec: Spec, q: number, chroma: '4:2:0' | '4:4:4' = '4:2:0'): Promise<Buffer> {
  const pipe = sharp(img.data, { raw: { width: img.width, height: img.height, channels: 3 } });
  const quality = Math.round(q * 100);
  return spec.kind === 'webp' ? pipe.webp({ quality }).toBuffer() : pipe.jpeg({ quality, chromaSubsampling: chroma, mozjpeg: false }).toBuffer();
}

interface Target {
  /** Source pixels the variant is made from (master-sized or the OG crop). */
  src: Raw;
  w: number;
  h: number;
}

/** Which specs exist for a photo of this master size (variantPlan never upscales). */
export function targetsFor(spec: Spec, master: Raw): Target | null {
  const plan = variantPlan(master.width, master.height);
  if (spec.id === 'master') return { src: master, w: master.width, h: master.height };
  if (spec.id === 'jpeg') return { src: master, w: plan.jpeg.w, h: plan.jpeg.h };
  if (spec.id === 'og') return { src: master, w: plan.og.w, h: plan.og.h };
  const tier = Number(spec.id.slice(1));
  const t = plan.webp.find((x) => x.tier === tier && x.tier <= master.width);
  return t ? { src: master, w: t.w, h: t.h } : null;
}

async function cropOg(master: Raw): Promise<Raw> {
  const c = variantPlan(master.width, master.height).og.crop;
  const { data, info } = await sharp(master.data, { raw: { width: master.width, height: master.height, channels: 3 } })
    .extract({ left: c.x, top: c.y, width: c.w, height: c.h })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

interface Cell {
  bytes: number[];
  ssim: number[];
  bpp: number[];
}

type CellKey = string;
const key = (specId: string, q: number, sharp: boolean, chroma = '420'): CellKey => `${specId}|${q}|${sharp ? 's' : 'n'}|${chroma}`;

export interface Measurement {
  samples: Sample[];
  /** Per sample: master size. */
  masters: Array<{ name: string; legacy: boolean; w: number; h: number; bytes: number }>;
  cells: Map<CellKey, Cell>;
  /** Number of samples that have each spec. */
  counts: Map<string, { all: number; real: number }>;
  /** Sum over samples of the bytes of all variants at start quality (with sharpening), per sample. */
  totals: number[];
}

export async function measure(samples: Sample[]): Promise<Measurement> {
  const cells = new Map<CellKey, Cell>();
  const counts = new Map<string, { all: number; real: number }>();
  const masters: Measurement['masters'] = [];
  const totals: number[] = [];
  const add = (k: CellKey, bytes: number, ssim: number, px: number) => {
    const c = cells.get(k) ?? { bytes: [], ssim: [], bpp: [] };
    c.bytes.push(bytes);
    c.ssim.push(ssim);
    c.bpp.push(bytes / px);
    cells.set(k, c);
  };
  for (const s of samples) {
    const raw = await decode(s.file);
    // Master: the source fitted to 3000 px (never upscaled), same as the admin.
    const long = Math.max(raw.width, raw.height);
    const master = long > 3000 ? await resizeRaw(raw, Math.max(1, Math.round((raw.width * 3000) / long)), Math.max(1, Math.round((raw.height * 3000) / long)), 'lanczos3') : raw;
    masters.push({ name: s.name, legacy: s.legacy, w: master.width, h: master.height, bytes: s.file.length });
    let total = 0;
    for (const spec of SPECS) {
      const t = targetsFor(spec, master);
      if (!t) continue;
      const c = counts.get(spec.id) ?? { all: 0, real: 0 };
      c.all++;
      if (!s.legacy) c.real++;
      counts.set(spec.id, c);
      const base = spec.id === 'og' ? await cropOg(master) : t.src;
      const ref = spec.id === 'master' ? base : await reference(base, t.w, t.h);
      const refLuma = await lumaOf(ref);
      const plain = spec.id === 'master' ? base : await halving(base, t.w, t.h);
      const amounts = spec.sharpen > 0 ? [0, spec.sharpen] : [0];
      for (const amount of amounts) {
        const img = await unsharp(plain, amount);
        for (const q of spec.qualities) {
          const chromas: Array<'4:2:0' | '4:4:4'> = spec.id === 'master' ? ['4:2:0', '4:4:4'] : ['4:2:0'];
          for (const chroma of chromas) {
            const buf = await encode(img, spec, q, chroma);
            const ssim = lumaSsim(refLuma, await lumaOf(buf), t.w, t.h);
            add(key(spec.id, q, amount > 0, chroma === '4:2:0' ? '420' : '444'), buf.length, ssim, t.w * t.h);
            if (q === spec.start && chroma === '4:2:0' && amount === spec.sharpen) total += buf.length;
          }
        }
      }
    }
    totals.push(total);
  }
  return { samples, masters, cells, counts, totals };
}

const f1 = (n: number) => n.toFixed(1);
const f4 = (n: number) => n.toFixed(4);
const kb = (n: number) => `${f1(n / KB)} KB`;
const qs = (q: number) => q.toFixed(2);

function cell(m: Measurement, spec: Spec, q: number, sharp: boolean, chroma = '420'): Cell | undefined {
  return m.cells.get(key(spec.id, q, sharp, chroma));
}

/** Highest quality (>= floor) at which the p90 bytes are within the cap, or null. */
function qualityWithinCap(m: Measurement, spec: Spec, sharp: boolean): number | null {
  const ok = spec.qualities.filter((q) => {
    const c = cell(m, spec, q, sharp);
    return c !== undefined && q >= spec.floor && percentile(c.bytes, 0.9) <= spec.cap;
  });
  return ok.length ? Math.max(...ok) : null;
}

export function renderReport(m: Measurement): string {
  const L: string[] = [];
  const realCount = m.masters.filter((x) => !x.legacy).length;
  const legacyCount = m.masters.length - realCount;
  L.push('# Photo quality measurements (T-265, WP-10 step 1)');
  L.push('');
  L.push('Generated by `npm run photo-quality` (scripts/photo-quality-measure.ts). Offline: sharp (libwebp/libjpeg), no browser, no network. Deterministic: two runs give a byte-identical file. Do not edit by hand.');
  L.push('');
  L.push('Where this is used: the adopted qualities and caps are in `packages/shared/src/photo-quality.ts` and described in `docs/ADMIN.md` ("Photo quality (WP-10)"). The final rerun on the photographer\'s originals (`samples/originals/`, gitignored) is VERIFY row 53 in `docs/VERIFY.md`; until then the numbers below are provisional.');
  L.push('');
  L.push('## Method');
  L.push('');
  L.push(`- Samples: ${m.masters.length} photos (${realCount} from samples/originals, ${legacyCount} legacy gallery JPEGs, every n-th file of legacy/fotky_web/galleries in sorted order; the legacy files are already lossy web JPEGs of about 1 MB, not camera originals).`);
  L.push(`- Library versions: sharp ${sharp.versions.sharp ?? '?'}, libvips ${sharp.versions.vips}, libwebp ${sharp.versions.webp ?? '?'}.`);
  L.push('- Candidate = canvas-like downscale (halving steps, bilinear, last step at most 2x) then optional unsharp mask on luma (sigma 0.6 px, amount per tier from plan 3.2), then encode. Reference = one direct Lanczos3 resize of the same source to the same size. Quality = luma SSIM (8x8 windows, step 4) of the decoded candidate against that reference. Bytes are exact encoded sizes; KB = 1024 B.');
  L.push('- sharp quality q*100 stands in for canvas.toBlob(quality): same libwebp / libjpeg family, but the browser encoder settings differ a little. Whether the real admin encoder matches is checked by `npm run admin-encode-check -- --report` (browser run, see below).');
  L.push('- p90 = nearest-rank 90th percentile over the samples. "Plan target met" compares the p90 bytes with the cap of plan 3.1.');
  if (realCount === 0) {
    L.push('');
    L.push(`**PROVISIONAL: every row below comes from the legacy gallery JPEGs only. They are already lossy web JPEGs (about 1 MB each) and often smaller than a tier: WebP 1600 exists on ${m.counts.get('w1600')?.all ?? 0} and WebP 2400 on ${m.counts.get('w2400')?.all ?? 0} of ${m.masters.length} photos. Their detail is already smoothed, so small tiers compress better than camera originals would and the master row only measures re-encoding a lossy file. Treat byte numbers as a lower bound; put 5 to 10 original JPEGs into samples/originals/ and re-run to get final numbers (plan question 1).**`);
  }
  L.push('');
  L.push('## Samples');
  L.push('');
  const widths = m.masters.map((x) => Math.max(x.w, x.h));
  L.push(`Long edge: min ${Math.min(...widths)}, median ${median(widths)}, max ${Math.max(...widths)} px. Source file size: median ${kb(median(m.masters.map((x) => x.bytes)))}, p90 ${kb(percentile(m.masters.map((x) => x.bytes), 0.9))}.`);
  L.push('');
  L.push('## Per variant at the plan start quality');
  L.push('');
  L.push('Sharpened = the unsharp amount of plan 3.2 for that tier. n = photos on which the variant exists (variantPlan never upscales).');
  L.push('');
  L.push('| Variant | n | Data | Start q | Median | p90 | Plan est. | Cap | Median B/px | Median SSIM | Plan target met (start q) | Met with floor | Highest q within cap |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const spec of SPECS) {
    const cnt = m.counts.get(spec.id);
    if (!cnt) {
      L.push(`| ${spec.label} | 0 | no source wide enough | ${qs(spec.start)} | - | - | ${kb(spec.estLow)} to ${kb(spec.estHigh)} | ${kb(spec.cap)} | - | - | not measured | not measured | - |`);
      continue;
    }
    const sharp = spec.sharpen > 0;
    const c = cell(m, spec, spec.start, sharp);
    if (!c) continue;
    const p90 = percentile(c.bytes, 0.9);
    const med = median(c.bytes);
    const within = qualityWithinCap(m, spec, sharp);
    const data = cnt.real === 0 ? 'legacy only, provisional' : cnt.real === cnt.all ? 'originals' : `${cnt.real} originals + ${cnt.all - cnt.real} legacy`;
    const inEst = med >= spec.estLow && med <= spec.estHigh;
    L.push(
      `| ${spec.label} | ${cnt.all} | ${data} | ${qs(spec.start)} | ${kb(med)}${inEst ? '' : ' (outside est.)'} | ${kb(p90)} | ${kb(spec.estLow)} to ${kb(spec.estHigh)} | ${kb(spec.cap)} | ${f4(median(c.bpp))} | ${f4(median(c.ssim))} | ${p90 <= spec.cap ? 'yes' : 'NO'} | ${within !== null ? 'yes' : 'NO'} | ${within !== null ? qs(within) : 'none >= floor'} |`,
    );
  }
  const tot = m.totals.filter((x) => x > 0);
  L.push('');
  L.push(`Sum of all variants of one photo at the start qualities (master included, only variants that exist): median ${kb(median(tot))}, p90 ${kb(percentile(tot, 0.9))} over ${tot.length} photos. The plan reference for a 3000x2000 photo is about 3.3 MB (2.9 to 4.2 MB); the legacy sources are lossy and often smaller than the 3000x2000 reference, so that figure is not confirmed by this sample set.`);
  L.push('');
  L.push('## Quality sweep with and without sharpening');
  L.push('');
  L.push('Median bytes / p90 bytes / median SSIM per quality. "plain" = no sharpening, "sharp" = plan amount. Only SSIM-vs-Lanczos is compared, so a sharpened result can score lower than the plain one: SSIM rewards fidelity to the reference, not perceived crispness (see the contact sheets).');
  for (const spec of SPECS) {
    const cnt = m.counts.get(spec.id);
    if (!cnt) continue;
    L.push('');
    L.push(`### ${spec.label} (n=${cnt.all}${cnt.real === 0 ? ', legacy only, provisional' : ''})`);
    L.push('');
    const hasSharp = spec.sharpen > 0;
    L.push(hasSharp ? '| q | plain median | plain p90 | plain SSIM | sharp median | sharp p90 | sharp SSIM |' : '| q | median | p90 | SSIM |');
    L.push(hasSharp ? '|---|---|---|---|---|---|---|' : '|---|---|---|---|');
    for (const q of spec.qualities) {
      const a = cell(m, spec, q, false);
      const b = cell(m, spec, q, true);
      if (!a) continue;
      const fmt = (c: Cell | undefined) => (c ? [kb(median(c.bytes)), kb(percentile(c.bytes, 0.9)), f4(median(c.ssim))] : ['-', '-', '-']);
      L.push(`| ${qs(q)}${q === spec.start ? ' (start)' : ''} | ${[...fmt(a), ...(hasSharp ? fmt(b) : [])].join(' | ')} |`);
    }
  }
  const mSpec = SPECS.find((s) => s.id === 'master') as Spec;
  if (m.counts.get('master')) {
    L.push('');
    L.push('## Master chroma subsampling 4:2:0 vs 4:4:4');
    L.push('');
    L.push('Plan 3.2: if the master costs more than 25 % extra, use q0.88. Canvas JPEG at q >= 0.9 may be 4:4:4 in Chrome (browser header check is part of `--report`).');
    L.push('');
    L.push('| q | 4:2:0 median | 4:4:4 median | extra bytes (ratio of medians) | 4:2:0 SSIM | 4:4:4 SSIM |');
    L.push('|---|---|---|---|---|---|');
    for (const q of mSpec.qualities) {
      const a = cell(m, mSpec, q, false, '420');
      const b = cell(m, mSpec, q, false, '444');
      if (!a || !b) continue;
      const ratio = median(b.bytes) / median(a.bytes);
      L.push(`| ${qs(q)} | ${kb(median(a.bytes))} | ${kb(median(b.bytes))} | ${f1((ratio - 1) * 100)} % | ${f4(median(a.ssim))} | ${f4(median(b.ssim))} |`);
    }
    L.push('');
    L.push('For the master the SSIM reference is the decoded source itself (same size), so it measures only the loss of the re-encode.');
  }
  L.push('');
  L.push('## Portrait ladder (plan 3.3)');
  L.push('');
  L.push('Tiers are chosen by width (variantPlan). Long edge of each tier for a 2:3 portrait master, to check that the portrait detail is not softer than the landscape one:');
  L.push('');
  L.push('| Master | WebP tiers (width x height) | JPEG | OG |');
  L.push('|---|---|---|---|');
  for (const [w, h] of [
    [3000, 2000],
    [2000, 3000],
    [2000, 2000],
    [1480, 987],
  ] as const) {
    const p = variantPlan(w, h);
    L.push(`| ${w}x${h} | ${p.webp.map((t) => `${t.w}x${t.h}`).join(', ')} | ${p.jpeg.w}x${p.jpeg.h} | ${p.og.w}x${p.og.h} |`);
  }
  L.push('');
  L.push('A 2000x3000 portrait master gets its widest WebP tier at 1600x2400: the long edge reaches 2400 px at the 1600 tier, so portrait photos are not softer than landscape ones. A portrait gets the 2400 tier only when its master is at least 2400 px wide (4:5 or squarer at the 3000 px cap); a 2:3 portrait stops at 1600x2400, which is the same 2400 px long edge as the landscape 2400 tier.');
  L.push('');
  L.push('## Not measured here');
  L.push('');
  L.push('- Real browser canvas output (Chrome/Safari encoders, chroma of canvas JPEG, wide-gamut P3 colour conversion): run `npm run admin-encode-check -- --report` for the Chrome numbers; Safari stays a human VERIFY item.');
  L.push('- Wide-gamut (P3) colour comparison: needs a P3 original; none in the repo.');
  L.push('- AVIF: out of scope (plan 3.4).');
  L.push('');
  return L.join('\n');
}

/** A few contact sheets (Lanczos | halving | halving + sharpen, WebP 720 at the start quality). Not part of the report. */
async function writeContactSheets(samples: Sample[]): Promise<void> {
  mkdirSync(SHEETS, { recursive: true });
  const spec = SPECS.find((s) => s.id === 'w720') as Spec;
  const picks = [samples[0], samples[Math.floor(samples.length / 2)], samples[samples.length - 1]].filter((x): x is Sample => x !== undefined);
  let n = 0;
  for (const s of picks) {
    const raw = await decode(s.file);
    const t = targetsFor(spec, raw);
    if (!t) continue;
    const ref = await reference(raw, t.w, t.h);
    const plain = await halving(raw, t.w, t.h);
    const sharpened = await unsharp(plain, spec.sharpen);
    const enc = async (img: Raw) => decode(await encode(img, spec, spec.start));
    const parts = [ref, await enc(plain), await enc(sharpened)];
    const tiles = await Promise.all(parts.map((p) => sharp_png(p)));
    const out = await sharp({ create: { width: t.w * 3 + 20, height: t.h, channels: 3, background: '#ffffff' } })
      .composite(tiles.map((input, i) => ({ input, left: i * (t.w + 10), top: 0 })))
      .jpeg({ quality: 90 })
      .toBuffer();
    writeFileSync(join(SHEETS, `sheet-${++n}.jpg`), out);
  }
}

const sharp_png = (r: Raw) => sharp(r.data, { raw: { width: r.width, height: r.height, channels: 3 } }).png().toBuffer();

export async function run(): Promise<string> {
  const samples = loadSamples();
  if (samples.length === 0) throw new Error('photo-quality: no sample images (legacy/fotky_web/galleries and samples/originals are both missing)');
  const report = renderReport(await measure(samples));
  mkdirSync(dirname(REPORT), { recursive: true });
  writeFileSync(REPORT, report);
  await writeContactSheets(samples);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await run();
  console.log(`photo-quality: wrote ${relative(ROOT, REPORT)} (${report.length} bytes, ${statSync(REPORT).size} on disk); contact sheets in ${relative(ROOT, SHEETS)}`);
}
