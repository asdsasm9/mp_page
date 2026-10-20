/**
 * Chooses the adapter set. The fake world is imported dynamically behind a build-time constant, so a
 * production build (VITE_BACKEND unset or "real") drops the branch and its chunk, and the bundle holds
 * no FAKE_WORLD_MARKER (checked by select.test.ts and, later, the gates).
 */
import type { AdminEnv } from '../env';
import { AdapterUnavailableError, type Ports } from '../ports';

export async function loadPorts(env: AdminEnv): Promise<Ports> {
  if (import.meta.env.VITE_BACKEND === 'fake' && env.backend === 'fake') {
    const { createFakePorts } = await import('./fake');
    return createFakePorts();
  }
  // Real adapters (supabase-js, fetch, XHR) arrive in later tasks; until then real mode cannot start.
  throw new AdapterUnavailableError();
}
