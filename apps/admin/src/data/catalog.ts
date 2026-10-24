/**
 * TanStack Query hooks over the CatalogPort. Reads run only while the session is ready (so nothing is
 * fetched before login) and go through runAuthed (a 401 opens the expiry modal and the call is repeated
 * after login). Mutations refuse to run offline and refresh every catalog query afterwards.
 */
import { useMutation, useQueries, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import type { PhotoRow } from '@mp/shared';
import { useSession } from '../auth/session';
import {
  NetworkError,
  type AlbumInput,
  type AlbumPatch,
  type CatalogPort,
  type CategoryInput,
  type CategoryPatch,
  type PhotoPatch,
  type SiteSettingsPatch,
  type UpdateOptions,
} from '../ports';
import { usePorts } from '../ports-context';
import { isOnline } from './health';

const ALL = ['catalog'] as const;

export const catalogKeys = {
  all: ALL,
  categories: () => [...ALL, 'categories'] as const,
  category: (id: string) => [...ALL, 'category', id] as const,
  albums: (categoryId?: string) => [...ALL, 'albums', categoryId ?? null] as const,
  album: (id: string) => [...ALL, 'album', id] as const,
  photos: (albumId: string) => [...ALL, 'photos', albumId] as const,
  photo: (id: string) => [...ALL, 'photo', id] as const,
  siteState: () => [...ALL, 'site-state'] as const,
  siteSettings: () => [...ALL, 'site-settings'] as const,
  appConfig: () => [...ALL, 'app-config'] as const,
  publishLog: (limit: number) => [...ALL, 'publish-log', limit] as const,
  changeLog: () => [...ALL, 'change-log'] as const,
};

function useCatalogQuery<T>(key: QueryKey, read: (catalog: CatalogPort) => Promise<T>, enabled = true) {
  const { catalog } = usePorts();
  const { status, runAuthed } = useSession();
  return useQuery({
    queryKey: key,
    queryFn: () => runAuthed(() => read(catalog)),
    enabled: enabled && status === 'ready',
  });
}

export const useCategories = () => useCatalogQuery(catalogKeys.categories(), (c) => c.listCategories());
export const useCategory = (id: string) => useCatalogQuery(catalogKeys.category(id), (c) => c.getCategory(id));
export const useAlbums = (categoryId?: string) =>
  useCatalogQuery(catalogKeys.albums(categoryId), (c) => c.listAlbums(categoryId === undefined ? {} : { categoryId }));
export const useAlbum = (id: string) => useCatalogQuery(catalogKeys.album(id), (c) => c.getAlbum(id));
export const usePhotos = (albumId: string) => useCatalogQuery(catalogKeys.photos(albumId), (c) => c.listPhotos(albumId));
export const usePhoto = (id: string) => useCatalogQuery(catalogKeys.photo(id), (c) => c.getPhoto(id));
/**
 * Number of photos per album id (same cache entries as usePhotos). `undefined` while an album's photos are
 * still loading or failed to load, so a screen never shows a wrong total.
 */
export function usePhotoCounts(albumIds: readonly string[]): ReadonlyMap<string, number | undefined> {
  const photos = usePhotosByAlbum(albumIds);
  return new Map(albumIds.map((id) => [id, photos.get(id)?.length] as const));
}

/**
 * The photos of several albums (counts and covers of a list), one cached request per album. PostgREST
 * aggregates are off on Supabase and a cover needs its photo row anyway, so no separate count call exists.
 * `undefined` while an album's photos are loading or failed.
 */
export function usePhotosByAlbum(albumIds: readonly string[]): ReadonlyMap<string, PhotoRow[] | undefined> {
  const { catalog } = usePorts();
  const { status, runAuthed } = useSession();
  const lists = useQueries({
    queries: albumIds.map((id) => ({
      queryKey: catalogKeys.photos(id),
      queryFn: () => runAuthed(() => catalog.listPhotos(id)),
      enabled: status === 'ready',
    })),
    combine: (results) => results.map((r) => r.data),
  });
  return new Map(albumIds.map((id, i) => [id, lists[i]] as const));
}

export const useSiteSettings = () => useCatalogQuery(catalogKeys.siteSettings(), (c) => c.getSiteSettings());
export const useSiteState = () => useCatalogQuery(catalogKeys.siteState(), (c) => c.getSiteState());
export const useChangeLog = () => useCatalogQuery(catalogKeys.changeLog(), (c) => c.listChangeLog());

/**
 * Number of unpublished changes: the length of the change log, the same lines "Zobrazit změny" lists, so the
 * number and the list cannot disagree. `undefined` while loading; if the log cannot be read it falls back to the
 * raw site_state counter (which then may differ from the list, but the list is not shown either).
 */
export function usePendingCount(): number | undefined {
  const changes = useChangeLog();
  const site = useSiteState();
  if (changes.data) return changes.data.length;
  if (changes.isError) return site.data?.pending_changes;
  return undefined;
}
export const usePublishLog =(limit: number) =>
  useCatalogQuery(catalogKeys.publishLog(limit), (c) => c.listPublishLog(limit));

function useCatalogMutation<V, R>(write: (catalog: CatalogPort, variables: V) => Promise<R>) {
  const { catalog } = usePorts();
  const { runAuthed } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: V): Promise<R> =>
      // Offline: no request is made; the UI also disables the control (useCanMutate).
      isOnline() ? runAuthed(() => write(catalog, variables)) : Promise.reject(new NetworkError()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: catalogKeys.all }),
  });
}

interface Update<P> {
  id: string;
  patch: P;
  options?: UpdateOptions;
}

export const useCreateCategory = () => useCatalogMutation((c, input: CategoryInput) => c.createCategory(input));
export const useUpdateCategory = () =>
  useCatalogMutation((c, v: Update<CategoryPatch>) => c.updateCategory(v.id, v.patch, v.options));
export const useDeleteCategory = () => useCatalogMutation((c, id: string) => c.deleteCategory(id));

export const useCreateAlbum = () => useCatalogMutation((c, input: AlbumInput) => c.createAlbum(input));
export const useUpdateAlbum = () =>
  useCatalogMutation((c, v: Update<AlbumPatch>) => c.updateAlbum(v.id, v.patch, v.options));
export const useDeleteAlbum = () => useCatalogMutation((c, id: string) => c.deleteAlbum(id));

export const useUpdateSiteSettings = () =>
  useCatalogMutation((c, patch: SiteSettingsPatch) => c.updateSiteSettings(patch));

export const useUpdatePhoto =() =>
  useCatalogMutation((c, v: Update<PhotoPatch>) => c.updatePhoto(v.id, v.patch, v.options));
