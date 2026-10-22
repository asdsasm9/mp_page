import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiError, NetworkError } from '../ports/errors';
import type { HealthStore } from './health';

/**
 * Retries only what can heal by itself: no connection, 429 and 5xx, at most twice. Every other 4xx is
 * final, and 401 is never retried here: the session layer asks the user to sign in and then repeats the call.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;
  if (error instanceof NetworkError) return true;
  return error instanceof ApiError && (error.status === 429 || error.status >= 500);
}

export interface QueryClientOptions {
  /** Tests switch retries off so a failure shows at once. */
  retry?: boolean;
}

export function createQueryClient(health: HealthStore, options: QueryClientOptions = {}): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onSuccess: () => health.success(),
      onError: (error) => health.failure(error),
    }),
    mutationCache: new MutationCache({
      onSuccess: () => health.success(),
      onError: (error) => health.failure(error),
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: options.retry === false ? false : shouldRetry,
      },
      mutations: { retry: false },
    },
  });
}
