/** Alt text rules (docs/SEO.md section 8). */

export const ALT_MAX = 300;
export const ALT_WARN = 125;

const FILENAME_RE = /\.(jpe?g|png|webp|avif)$/i;
const GENERIC_PREFIX_RE = /^(image|photo|foto|obrázek)\b/i;

export interface AltResult {
  ok: boolean;
  problems: string[];
  warnings: string[];
}

export function validateAlt(alt: string): AltResult {
  const problems: string[] = [];
  const warnings: string[] = [];
  const text = alt.trim();
  if (FILENAME_RE.test(text)) problems.push('Alt looks like a file name.');
  if (GENERIC_PREFIX_RE.test(text)) problems.push('Alt starts with a generic word (image, photo, foto, obrázek).');
  if (/[\\/]/.test(text)) problems.push('Alt contains a path separator.');
  if (text.length > ALT_MAX) problems.push(`Alt is longer than ${ALT_MAX} characters.`);
  else if (text.length > ALT_WARN) warnings.push(`Alt is longer than ${ALT_WARN} characters.`);
  return { ok: problems.length === 0, problems, warnings };
}

const SINGULAR: Record<string, string> = {
  svatby: 'svatba',
  portrety: 'portrét',
  'parove-foceni': 'párové focení',
};

export interface AltContext {
  albumTitle: string;
  /** Category slug (preferred) or category name. */
  categoryKey: string;
  /** 1-based position of the photo in the album. */
  n: number;
  total: number;
}

export function defaultAlt(ctx: AltContext): string {
  const singular = SINGULAR[ctx.categoryKey] ?? ctx.categoryKey.toLowerCase();
  return `${ctx.albumTitle} – ${singular}, fotografie ${ctx.n} z ${ctx.total}`;
}

export function effectiveAlt(photo: { alt?: string | null }, ctx: AltContext): string {
  const stored = photo.alt?.trim();
  return stored ? stored : defaultAlt(ctx);
}

/** Groups of photos in one album sharing the same non-empty (trimmed) alt. */
export function findDuplicateAlts<T extends { alt?: string | null }>(photos: T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const p of photos) {
    const a = p.alt?.trim();
    if (!a) continue;
    const g = groups.get(a);
    if (g) g.push(p);
    else groups.set(a, [p]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}
