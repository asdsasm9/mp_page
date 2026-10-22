/**
 * Storage status (GET /storage) and the actions that change it. The bars render exactly what the
 * Worker returns; this file only fetches and refreshes. Refresh happens after every upload commit and
 * photo delete, and every 60 s while the tab is visible (TanStack pauses the interval in the background).
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { CommitRequest, DeleteRequest } from '@mp/shared';
import { useSession } from '../auth/session';
import { NetworkError } from '../ports';
import { usePorts } from '../ports-context';
import { catalogKeys } from './catalog';
import { isOnline } from './health';

export const STORAGE_REFRESH_MS = 60_000;

export const storageKeys = { all: ['storage'] as const };

export function useStorage() {
  const { api } = usePorts();
  const { status, runAuthed } = useSession();
  return useQuery({
    queryKey: storageKeys.all,
    queryFn: () => runAuthed(() => api.getStorage()),
    enabled: status === 'ready',
    refetchInterval: STORAGE_REFRESH_MS,
    refetchIntervalInBackground: false,
  });
}

/** After anything that changes stored bytes or what the site would publish: storage bar and publish dot. */
export function refreshStorageAndSite(queryClient: QueryClient): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: storageKeys.all }),
    queryClient.invalidateQueries({ queryKey: catalogKeys.siteState() }),
    queryClient.invalidateQueries({ queryKey: catalogKeys.changeLog() }),
  ]).then(() => undefined);
}

function useApiMutation<V, R>(write: (api: ReturnType<typeof usePorts>['api'], variables: V) => Promise<R>) {
  const ports = usePorts();
  const { runAuthed } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: V): Promise<R> =>
      isOnline() ? runAuthed(() => write(ports.api, variables)) : Promise.reject(new NetworkError()),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: catalogKeys.all });
      await refreshStorageAndSite(queryClient);
    },
  });
}

/** POST /photos/delete: the storage bar and the publish dot refresh afterwards. */
export const useDeletePhotos = () => useApiMutation((api, request: DeleteRequest) => api.deletePhotos(request));

export interface CommitInput {
  request: CommitRequest;
  /** Aborts the request (cancel in the upload queue). */
  signal?: AbortSignal;
}

/** POST /uploads/commit: the storage bar, the publish dot and the photo lists refresh afterwards. */
export const useCommitUpload = () =>
  useApiMutation((api, input: CommitInput) =>
    api.commit(input.request, input.signal === undefined ? undefined : { signal: input.signal }),
  );
