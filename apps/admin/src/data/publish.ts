/**
 * Publish flow (ADMIN-UX 3.6, plan 4.9): POST /publish, then poll the public site's `/_publish.json` every
 * 5 s (never cached) until its snapshot time reaches the one /publish returned, for at most 6 minutes.
 * All waiting goes through the injected Clock, so tests drive it with the fake clock. Polling stops when
 * the screen unmounts. A status file that cannot be read (CORS header missing, offline) is not an error:
 * the flow ends in "build triggered" because /publish itself succeeded.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from '../auth/session';
import { ApiError } from '../ports';
import { usePorts } from '../ports-context';
import { catalogKeys } from './catalog';

export const POLL_INTERVAL_MS = 5_000;
export const POLL_MAX_MS = 6 * 60_000;

export type PublishPhase =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'building' }
  | { kind: 'triggered' }
  | { kind: 'done' }
  | { kind: 'timeout' }
  | { kind: 'failed'; error: unknown };

export interface PublishFlow {
  phase: PublishPhase;
  /** True while a publish is being requested or the site is being rebuilt. */
  busy: boolean;
  /** Set when the button is pressed during `busy`. Cleared by the next accepted press. */
  repeatPressed: boolean;
  publish(): void;
}

export function usePublishFlow(): PublishFlow {
  const { api, publishStatus, clock } = usePorts();
  const { runAuthed } = useSession();
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<PublishPhase>({ kind: 'idle' });
  const [repeatPressed, setRepeatPressed] = useState(false);
  const busyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const publish = useCallback(() => {
    if (busyRef.current) {
      setRepeatPressed(true);
      return;
    }
    busyRef.current = true;
    setRepeatPressed(false);
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;
    const set = (next: PublishPhase) => {
      if (!signal.aborted) setPhase(next);
    };
    const refresh = () => queryClient.invalidateQueries({ queryKey: catalogKeys.all });

    const run = async () => {
      set({ kind: 'starting' });
      let target: string;
      try {
        target = (await runAuthed(() => api.publish())).snapshot_generated_at;
      } catch (error) {
        set({ kind: 'failed', error });
        return;
      } finally {
        void refresh();
      }
      set({ kind: 'building' });
      const targetMs = Date.parse(target);
      const startedAt = clock.now();
      try {
        while (clock.now() - startedAt < POLL_MAX_MS) {
          await clock.sleep(POLL_INTERVAL_MS, signal);
          if (signal.aborted) return;
          const status = await publishStatus.read();
          if (signal.aborted) return;
          if (status && Date.parse(status.snapshotGeneratedAt) >= targetMs) {
            set({ kind: 'done' });
            return;
          }
        }
        set({ kind: 'timeout' });
      } catch {
        // Unmount aborts the sleep; an unreadable status file means "build triggered", never an error.
        set({ kind: 'triggered' });
      }
    };

    void run().finally(() => {
      busyRef.current = false;
      if (abortRef.current === controller) abortRef.current = null;
    });
  }, [api, publishStatus, clock, runAuthed, queryClient]);

  return { phase, busy: phase.kind === 'starting' || phase.kind === 'building', repeatPressed, publish };
}

/** The failure to show: PUBLISH_FAILED and any 502 share the "web stays as it was" text. */
export function isPublishFailure(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 'PUBLISH_FAILED' || error.status === 502);
}
