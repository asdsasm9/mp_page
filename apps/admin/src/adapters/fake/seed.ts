/** Fills a fake world from a public snapshot (the fixture), the way a migrated catalog would look. */
import { allKeys, masterKey, sumBytes, variantBytes, type AlbumRow, type CategoryRow, type PhotoRow, type Snapshot } from '@mp/shared';
import type { Core } from './core';

const DAY_MS = 86_400_000;

export function seedFromSnapshot(core: Core, snapshot: Snapshot): void {
  const { state } = core;
  const objectAge = core.clock.now() - DAY_MS;
  snapshot.categories.forEach((c, ci) => {
    const category: CategoryRow = {
      id: core.ids.uuid(),
      slug: c.slug,
      name: c.name,
      description: c.description,
      seo_title: c.seoTitle,
      seo_description: c.seoDescription,
      sort: (ci + 1) * 10,
      visible: true,
      created_at: c.updatedAt,
      updated_at: c.updatedAt,
    };
    state.categories.set(category.id, category);
    c.albums.forEach((a, ai) => {
      const album: AlbumRow = {
        id: core.ids.uuid(),
        category_id: category.id,
        slug: a.slug,
        title: a.title,
        place: a.place,
        shot_on: a.shotOn,
        description: a.description,
        seo_title: a.seoTitle,
        seo_description: a.seoDescription,
        cover_photo_id: a.coverPhotoId,
        sort: (ai + 1) * 10,
        published: true,
        legacy_id: a.legacyId,
        created_at: a.updatedAt,
        updated_at: a.updatedAt,
      };
      state.albums.set(album.id, album);
      a.photos.forEach((p, pi) => {
        const photo: PhotoRow = {
          id: p.id,
          album_id: album.id,
          master_key: masterKey(p.id),
          width: p.width,
          height: p.height,
          variants: structuredClone(p.variants),
          bytes_total: sumBytes(p.variants),
          dominant_color: p.dominantColor,
          alt: p.alt,
          caption: p.caption,
          sort: (pi + 1) * 10,
          legacy_key: null,
          created_at: a.updatedAt,
          updated_at: a.updatedAt,
        };
        state.photos.set(photo.id, photo);
        const sizes = variantBytes(p.variants);
        allKeys(p.id, p.variants).forEach((key, i) => state.objects.set(key, { bytes: sizes[i]!, uploadedAtMs: objectAge }));
      });
    });
  });
  state.site.last_published_at = snapshot.generatedAt;
  state.published = { snapshotGeneratedAt: snapshot.generatedAt, builtAt: snapshot.generatedAt, counts: structuredClone(snapshot.counts) };
}
