/**
 * TanStack Query hooks over the CatalogPort. Reads run only while the session is ready (so nothing is
 * fetched before login) and go through runAuthed (a 401 opens the expiry modal and the call is repeated
 * after login). Mutations refuse to run offline and refresh every catalog query afterwards.
 */
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useSession } from '../auth/session';
import {
  NetworkError,
  type AlbumInput,
  type AlbumPatch,
  type CatalogPort,
  type CategoryInput,
  type CategoryPatch,
  type PhotoPatch,
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
  publishLog: (limit: number) => [...ALL, 'publish-log', limit] as const,
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
export const useSiteState = () => useCatalogQuery(catalogKeys.siteState(), (c) => c.getSiteState());
export const usePublishLog = (limit: number) =>
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

export const useUpdatePhoto = () =>
  useCatalogMutation((c, v: Update<PhotoPatch>) => c.updatePhoto(v.id, v.patch, v.options));
