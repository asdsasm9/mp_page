/**
 * Connectivity state for the banners: "offline" comes from the browser (navigator.onLine and its events),
 * "service unavailable" from the data layer (the Worker or Supabase answered 5xx, or a request got no
 * answer while the browser says it is online, which is what a paused Supabase project looks like).
 * It clears with the next successful request.
 */
import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import { ApiError, NetworkError } from '../ports/errors';

export function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

function subscribeOnline(listener: () => void): () => void {
  window.addEventListener('online', listener);
  window.addEventListener('offline', listener);
  return () => {
    window.removeEventListener('online', listener);
    window.removeEventListener('offline', listener);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, isOnline, () => true);
}

/** False while offline: every mutating control is disabled with it (reading stays possible). */
export function useCanMutate(): boolean {
  return useOnline();
}

/** The failure means the back end is down, not that this request was wrong. */
export function isUnavailableError(error: unknown): boolean {
  if (error instanceof ApiError) return error.status >= 500;
  return error instanceof NetworkError && isOnline();
}

export interface HealthStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): boolean;
  failure(error: unknown): void;
  success(): void;
}

export function createHealthStore(): HealthStore {
  let unavailable = false;
  const listeners = new Set<() => void>();
  const set = (next: boolean) => {
    if (next === unavailable) return;
    unavailable = next;
    listeners.forEach((fn) => fn());
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => unavailable,
    failure(error) {
      if (isUnavailableError(error)) set(true);
    },
    success() {
      set(false);
    },
  };
}

const HealthContext = createContext<HealthStore | null>(null);

export function HealthProvider({ store, children }: { store: HealthStore; children: ReactNode }) {
  return <HealthContext.Provider value={store}>{children}</HealthContext.Provider>;
}

export function useServiceUnavailable(): boolean {
  const store = useContext(HealthContext);
  if (!store) throw new Error('useServiceUnavailable outside HealthProvider');
  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => false);
}
