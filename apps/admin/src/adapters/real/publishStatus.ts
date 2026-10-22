/**
 * Real PublishStatusPort: GET `<public site>/_publish.json`, never cached. 404 means "no file yet" (null).
 * Anything else that goes wrong (offline, the CORS header of WP5-24 not deployed, a non-JSON answer) is a
 * NetworkError; the publish screen turns that into the "build triggered" state instead of an error.
 * Sends no credentials and logs nothing.
 */
import { NetworkError, type PublishStatus, type PublishStatusPort } from '../../ports';
import { defaultFetch, send, type FetchFn } from './http';

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function parse(body: unknown): PublishStatus | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const counts = b.counts as Record<string, unknown> | null | undefined;
  if (typeof b.snapshotGeneratedAt !== 'string' || Number.isNaN(Date.parse(b.snapshotGeneratedAt))) return null;
  return {
    snapshotGeneratedAt: b.snapshotGeneratedAt,
    builtAt: typeof b.builtAt === 'string' ? b.builtAt : '',
    counts: {
      categories: isCount(counts?.categories) ? counts.categories : 0,
      albums: isCount(counts?.albums) ? counts.albums : 0,
      photos: isCount(counts?.photos) ? counts.photos : 0,
    },
  };
}

export function createRealPublishStatus(config: { siteUrl: string; fetch?: FetchFn }): PublishStatusPort {
  const fetchFn = config.fetch ?? defaultFetch;
  const url = `${config.siteUrl.replace(/\/+$/, '')}/_publish.json`;
  return {
    async read() {
      const res = await send(fetchFn, url, { method: 'GET', cache: 'no-store', credentials: 'omit' });
      if (res.status === 404) return null;
      if (!res.ok) throw new NetworkError();
      const parsed = parse(await res.json().catch(() => null));
      if (!parsed) throw new NetworkError();
      return parsed;
    },
  };
}
