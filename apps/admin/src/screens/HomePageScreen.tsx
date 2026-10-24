/** "Úvodní stránka" (`/uvodni-stranka`, WP-12 step 28, T-286): settings of the public home page; today the hero photo. */
import { useMemo } from 'react';
import { LoadFailure } from '../components/LoadFailure';
import { PageLoading } from '../components/PageLoading';
import { useDocumentTitle } from '../components/Page';
import { useAlbums, useCategories, usePhotosByAlbum, useSiteSettings } from '../data/catalog';
import { cs } from '../i18n/cs';
import { HeroPhotoBlock } from './HeroPhotoBlock';

export function HomePageScreen() {
  useDocumentTitle(cs.routes.homePage.title);
  const settings = useSiteSettings();
  const categories = useCategories();
  const albums = useAlbums();
  const categoryRows = useMemo(() => categories.data ?? [], [categories.data]);
  // Display order: category order, then album order inside it (the list itself is ordered by album sort only).
  const albumRows = useMemo(() => {
    const rank = new Map(categoryRows.map((c, i) => [c.id, i] as const));
    return [...(albums.data ?? [])].sort(
      (a, b) => (rank.get(a.category_id) ?? 0) - (rank.get(b.category_id) ?? 0),
    );
  }, [albums.data, categoryRows]);
  const photos = usePhotosByAlbum(useMemo(() => albumRows.map((a) => a.id), [albumRows]));

  const failed = settings.isError ? settings : categories.isError ? categories : albums.isError ? albums : null;
  const ready = settings.data && categories.data && albums.data;

  return (
    <div className="page">
      <h1>{cs.routes.homePage.title}</h1>
      {failed ? (
        <LoadFailure error={failed.error} message={cs.heroPhoto.loadFailed} onRetry={() => void failed.refetch()} />
      ) : ready ? (
        <HeroPhotoBlock
          heroPhotoId={settings.data.hero_photo_id}
          categories={categoryRows}
          albums={albumRows}
          photos={photos}
        />
      ) : (
        <PageLoading>{cs.data.loading}</PageLoading>
      )}
    </div>
  );
}
