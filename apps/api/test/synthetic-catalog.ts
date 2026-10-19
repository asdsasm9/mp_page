/**
 * Synthetic catalog rows for the size and CPU benchmark (WP4-19). Deterministic, no randomness.
 * Shape is deliberately realistic: 3000x2000 masters (all four WebP tiers), alt text, a colour.
 */
import { variantPlan, type AlbumRow, type CategoryRow, type PhotoRow, type PhotoVariants } from '@mp/shared';
import type { CatalogRows } from '../src/publish-service';

const hex = (n: number, len: number): string => n.toString(16).padStart(len, '0');
const uuid = (kind: number, n: number): string => `${hex(kind, 8)}-0000-4000-8000-${hex(n, 12)}`;

function variants(w: number, h: number): PhotoVariants {
  const p = variantPlan(w, h);
  const bpp = (px: number, rate: number) => Math.ceil(px * rate);
  return {
    master: { w: p.master.w, h: p.master.h, bytes: bpp(p.master.w * p.master.h, 0.25) },
    webp: p.webp.map((e) => ({ tier: e.tier as 480, w: e.w, h: e.h, bytes: bpp(e.w * e.h, 0.12) })),
    jpeg: { w: p.jpeg.w, h: p.jpeg.h, bytes: bpp(p.jpeg.w * p.jpeg.h, 0.22) },
    og: { w: p.og.w, h: p.og.h, bytes: bpp(p.og.w * p.og.h, 0.18) },
  };
}

export interface SyntheticOptions {
  photos: number;
  categories?: number;
  albums?: number;
  /** Extra url_history rows (redirects). */
  redirects?: number;
}

export function syntheticCatalog(opts: SyntheticOptions): CatalogRows {
  const catCount = opts.categories ?? 5;
  const albumCount = opts.albums ?? 50;
  const stamp = '2026-10-19T12:00:00.000Z';
  const categories: CategoryRow[] = [];
  for (let c = 0; c < catCount; c++) {
    categories.push({
      id: uuid(1, c),
      slug: `kategorie-${c}`,
      name: `Kategorie ${c}`,
      description: 'Popis kategorie, dve vety pro realisticky odhad velikosti.',
      seo_title: `Kategorie ${c} | Mullny Photos`,
      seo_description: 'Kratky SEO popis kategorie, zhruba sto padesat znaku pro odhad velikosti.',
      sort: c,
      visible: true,
      created_at: stamp,
      updated_at: stamp,
    });
  }
  const albums: AlbumRow[] = [];
  for (let a = 0; a < albumCount; a++) {
    albums.push({
      id: uuid(2, a),
      category_id: uuid(1, a % catCount),
      slug: `album-${a}`,
      title: `Album cislo ${a}`,
      place: 'Praha',
      shot_on: '2026-06-01',
      description: 'Popis alba, nekolik vet o dni a mistech, aby velikost odpovidala skutecnemu obsahu.',
      seo_title: `Album ${a}`,
      seo_description: 'Kratky SEO popis alba.',
      cover_photo_id: null,
      sort: a,
      published: true,
      legacy_id: null,
      created_at: stamp,
      updated_at: stamp,
    });
  }
  const photos: PhotoRow[] = [];
  const v = variants(3000, 2000);
  for (let i = 0; i < opts.photos; i++) {
    const bytes_total = v.master.bytes + v.webp.reduce((s, e) => s + e.bytes, 0) + v.jpeg.bytes + v.og.bytes;
    photos.push({
      id: uuid(3, i),
      album_id: uuid(2, i % albumCount),
      master_key: `photos/${uuid(3, i)}/master.jpg`,
      width: 3000,
      height: 2000,
      variants: v,
      bytes_total,
      dominant_color: `#${hex((i * 2654435) % 0xffffff, 6)}`,
      alt: `Svatebni foto cislo ${i}, novomanzele v parku pri zapadu slunce`,
      caption: null,
      sort: i,
      legacy_key: null,
      created_at: stamp,
      updated_at: stamp,
    });
  }
  const urlHistory = Array.from({ length: opts.redirects ?? 0 }, (_, i) => ({
    id: uuid(4, i),
    old_path: `/stare/${i}`,
    target: `/svatby/album-${i % albumCount}/`,
    status: 301 as const,
    created_at: stamp,
  }));
  return { categories, albums, photos, urlHistory };
}
