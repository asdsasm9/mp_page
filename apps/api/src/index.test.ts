import { describe, expect, it } from 'vitest';
import worker from './index';

const call = (path: string, init?: RequestInit) =>
  worker.fetch(new Request(`https://api.test${path}`, init));

describe('api stub', () => {
  it('GET /health returns {ok:true}', async () => {
    const res = await call('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('unknown path returns 404 NOT_FOUND', async () => {
    const res = await call('/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'NOT_FOUND' });
  });

  it('POST /health is refused with 405', async () => {
    const res = await call('/health', { method: 'POST' });
    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({ error: 'METHOD_NOT_ALLOWED' });
  });
});
