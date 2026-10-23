/**
 * First-load weight of a built page, measured from `dist` (plan WP-3 section 4.5 and step WP3-23; reusable by
 * the budget gate). Counts: gzip size of the HTML, the linked local stylesheets and scripts, the raw size of
 * preloaded fonts, and the images that load at once (eager or fetchpriority=high). Local images are read from
 * `dist`; images on the image host are not in `dist`, so their size comes from `imageBytes` (the snapshot's
 * stored variant sizes). For a `<picture>` the smallest WebP candidate that covers the need (slot x DPR) is assumed.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { Snapshot } from '@mp/shared';

export const KB = 1024;

/** Limits from docs/SEO.md section 9 / plan WP3-23. */
export const BUDGET = {
  html: 40 * KB,
  css: 30 * KB,
  js: 60 * KB,
  // WP-12 / T-274: Cormorant Garamond 400 + Lora 400, latin + latin-ext = 4 files, measured 75,928 B
  // (74.2 KB); budget = measured + about 10%, rounded up (hard cap of the plan: 120 KB).
  fonts: 84 * KB,
  fontFiles: 4,
  images: 250 * KB,
  total: 500 * KB,
} as const;

export interface Weight {
  html: number;
  css: number;
  js: number;
  fonts: number;
  fontFiles: number;
  images: number;
  /** Sources of eager images whose size could not be determined (should be empty). */
  unknownImages: string[];
  total: number;
}

export interface WeightOptions {
  /** Directory of the build output. */
  distDir: string;
  /** Page path like `/svatby/`. */
  page: string;
  /** Size in bytes of an image URL that is not in `dist`; undefined when unknown. */
  imageBytes?: (url: string) => number | undefined;
  /** CSS pixels of the image slot. Default: the design-check phone (412 px wide, 4vw gutter each side). */
  slotWidth?: number;
  /** Device pixel ratio. Default 1.75 (the design-check phone). */
  dpr?: number;
}

/** Design-check defaults: viewport 412 px, gutter 4vw per side, DPR 1.75 -> need ~663 px. */
export const DEFAULT_VIEWPORT = 412;
export const DEFAULT_GUTTER_VW = 0.04;
export const DEFAULT_SLOT_WIDTH = DEFAULT_VIEWPORT * (1 - 2 * DEFAULT_GUTTER_VW);
export const DEFAULT_DPR = 1.75;

/** Device pixels an image must supply: slot (CSS px) x DPR. */
export const neededWidth = (slotWidth: number = DEFAULT_SLOT_WIDTH, dpr: number = DEFAULT_DPR): number => slotWidth * dpr;

const gz = (buf: Buffer | string): number => gzipSync(buf, { level: 9 }).length;

const attr = (tag: string, name: string): string | undefined =>
  new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

/** True for a URL that points into the built site (path or same-site relative), not another host. */
const isLocal = (u: string): boolean => u.startsWith('/') && !u.startsWith('//');

function readLocal(distDir: string, urlPath: string): Buffer | null {
  try {
    return readFileSync(join(distDir, decodeURIComponent(urlPath.split(/[?#]/)[0]!)));
  } catch {
    return null;
  }
}

/** Candidate from a `srcset` for a slot: the smallest one with width >= slot, else the largest. */
export function pickCandidate(srcset: string, slotWidth: number): string | undefined {
  const entries = srcset
    .split(',')
    .map((s) => s.trim().split(/\s+/))
    .map(([url, w]) => ({ url: url!, w: Number.parseInt(w ?? '', 10) }))
    .filter((e) => e.url && Number.isFinite(e.w))
    .sort((a, b) => a.w - b.w);
  return (entries.find((e) => e.w >= slotWidth) ?? entries[entries.length - 1])?.url;
}

/** Image URLs that load at once on the page: eager or high-priority `<img>`, resolved through their `<picture>`. */
export function aboveFoldImageUrls(html: string, need: number = neededWidth()): string[] {
  const urls: string[] = [];
  const re = /<picture\b[\s\S]*?<\/picture>|<img\b[^>]*>/g;
  for (const m of html.matchAll(re)) {
    const block = m[0];
    const img = /<img\b[^>]*>/.exec(block)?.[0];
    if (!img) continue;
    const eager = attr(img, 'loading') === 'eager' || attr(img, 'fetchpriority') === 'high';
    if (!eager) continue;
    const source = /<source\b[^>]*\ssrcset="([^"]+)"/.exec(block)?.[1];
    // A bare `<img srcset>` (Astro's static images) is resolved like a `<source>`; `src` is only its fallback.
    const set = source ?? attr(img, 'srcset');
    const url = (set && pickCandidate(set, need)) || attr(img, 'src');
    if (url) urls.push(url);
  }
  return urls;
}

export function measureFirstLoad(opts: WeightOptions): Weight {
  const { distDir, page, imageBytes, slotWidth, dpr } = opts;
  const need = neededWidth(slotWidth, dpr);
  const htmlBuf = readFileSync(join(distDir, page, 'index.html'));
  const html = htmlBuf.toString('utf8');
  const w: Weight = { html: gz(htmlBuf), css: 0, js: 0, fonts: 0, fontFiles: 0, images: 0, unknownImages: [], total: 0 };

  for (const [tag] of html.matchAll(/<link\b[^>]*>/g)) {
    const href = attr(tag, 'href');
    if (!href || !isLocal(href)) continue;
    if (attr(tag, 'rel') === 'stylesheet') w.css += gz(readLocal(distDir, href) ?? '');
    else if (attr(tag, 'rel') === 'preload' && attr(tag, 'as') === 'font') {
      w.fonts += readLocal(distDir, href)?.length ?? 0;
      w.fontFiles += 1;
    }
  }
  for (const [tag] of html.matchAll(/<script\b[^>]*>/g)) {
    const src = attr(tag, 'src');
    if (src && isLocal(src)) w.js += gz(readLocal(distDir, src) ?? '');
  }
  for (const url of aboveFoldImageUrls(html, need)) {
    const size = isLocal(url) ? readLocal(distDir, url)?.length : imageBytes?.(url);
    if (size === undefined) w.unknownImages.push(url);
    else w.images += size;
  }
  w.total = w.html + w.css + w.js + w.fonts + w.images;
  return w;
}

/** Problems of a measurement against BUDGET; empty when it fits. */
export function checkWeight(w: Weight): string[] {
  const problems: string[] = [];
  const over = (name: string, value: number, limit: number): void => {
    if (value > limit) problems.push(`${name} ${value} B is over ${limit} B`);
  };
  over('html (gzip)', w.html, BUDGET.html);
  over('css (gzip)', w.css, BUDGET.css);
  over('js (gzip)', w.js, BUDGET.js);
  over('fonts', w.fonts, BUDGET.fonts);
  over('font files', w.fontFiles, BUDGET.fontFiles);
  over('above-the-fold images', w.images, BUDGET.images);
  over('first load total', w.total, BUDGET.total);
  for (const u of w.unknownImages) problems.push(`unknown size of eager image ${u}`);
  return problems;
}

/** Size resolver for images on the image host: `.../photos/<id>/<480|960|1600|2400>.webp` and `1600.jpg`, from the snapshot. */
export function snapshotImageBytes(snapshot: Snapshot): (url: string) => number | undefined {
  const sizes = new Map<string, number>();
  for (const c of snapshot.categories)
    for (const a of c.albums)
      for (const p of a.photos) {
        for (const v of p.variants.webp) sizes.set(`${p.id}/${v.tier}.webp`, v.bytes);
        sizes.set(`${p.id}/1600.jpg`, p.variants.jpeg.bytes);
        sizes.set(`${p.id}/og.jpg`, p.variants.og.bytes);
      }
  return (url) => {
    const m = /photos\/([0-9a-f-]{36})\/([^/?#]+)$/.exec(url);
    return m ? sizes.get(`${m[1]}/${m[2]}`) : undefined;
  };
}
