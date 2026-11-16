/**
 * TanStack Query hooks over the PlannerPort (Instagram planner, WP-14). Same shape as data/catalog.ts: reads run
 * only while the session is ready and go through runAuthed; mutations refuse to run offline and refresh every
 * planner query afterwards. Planner data is never a site change, so nothing here touches the catalog or publish keys.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from '../auth/session';
import {
  NetworkError,
  type IgPostInput,
  type IgPostPatch,
  type IgProfilePatch,
  type PlannerPort, type UpdateOptions } from '../ports';
import { usePorts } from '../ports-context';
import { isOnline } from './health';

const ALL = ['planner'] as const;

export const plannerKeys = {
  all: ALL,
  posts: () => [...ALL, 'posts'] as const,
  profile: () => [...ALL, 'profile'] as const,
};

/** Separate from the posts so a failing profile (e.g. migration not applied yet) never blocks the grid. */
export function useIgProfile() {
  const { planner } = usePorts();
  const { status, runAuthed } = useSession();
  return useQuery({
    queryKey: plannerKeys.profile(),
    queryFn: () => runAuthed(() => planner.getProfile()),
    enabled: status === 'ready',
  });
}

export function useIgPosts() {
  const { planner } = usePorts();
  const { status, runAuthed } = useSession();
  return useQuery({
    queryKey: plannerKeys.posts(),
    queryFn: () => runAuthed(() => planner.listPosts()),
    enabled: status === 'ready',
  });
}

function usePlannerMutation<V, R>(write: (planner: PlannerPort, variables: V) => Promise<R>) {
  const { planner } = usePorts();
  const { runAuthed } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: V): Promise<R> =>
      // Offline: no request is made; the UI also disables the control (useCanMutate).
      isOnline() ? runAuthed(() => write(planner, variables)) : Promise.reject(new NetworkError()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: plannerKeys.all }),
  });
}

export const useCreateIgPost = () => usePlannerMutation((p, input: IgPostInput) => p.createPost(input));
export const useUpdateIgPost = () =>
  usePlannerMutation((p, v: { id: string; patch: IgPostPatch; options?: UpdateOptions }) =>
    p.updatePost(v.id, v.patch, v.options),
  );
export const useSetIgPostPhotos = () =>
  usePlannerMutation((p, v: { id: string; photoIds: readonly string[] }) => p.setPostPhotos(v.id, v.photoIds));
export const useReorderIgPosts = () =>
  usePlannerMutation((p, order: readonly { id: string; sort: number }[]) => p.reorderPosts(order));
export const useMarkIgPostPosted = () =>
  usePlannerMutation((p, v: { id: string; postedAt: string; options?: UpdateOptions }) =>
    p.markPosted(v.id, v.postedAt, v.options),
  );
export const useUnmarkIgPostPosted = () =>
  usePlannerMutation((p, v: { id: string; options?: UpdateOptions }) => p.unmarkPosted(v.id, v.options));
export const useUpdateIgProfile = () =>
  usePlannerMutation((p, v: { patch: IgProfilePatch; options?: UpdateOptions }) => p.updateProfile(v.patch, v.options));
export const useDeleteIgPost = () => usePlannerMutation((p, id: string) => p.deletePost(id));
