import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createFakeStorage } from '@mp/shared';
import { createApp } from '../src/index';
import { makeWorld, type World } from './supabase-shim';

let world: World;
const storage = () => ({ photos: createFakeStorage({ baseUrl: 'https://img.test' }) });

const LISTED = { id: '33333333-3333-3333-3333-333333333333', email: 'listed.person@example.test', token: 'aaaaaaaa.bbbbbbbb.glst' };
const STRANGER = { id: '44444444-4444-4444-4444-444444444444', email: 'stranger.person@example.test', token: 'aaaaaaaa.bbbbbbbb.gstr' };
const EMAIL_ONLY = { id: '55555555-5555-5555-5555-555555555555', email: 'mail.only@example.test', token: 'aaaaaaaa.bbbbbbbb.emon' };

beforeAll(async () => {
  world = await makeWorld({ deps: { storage } });
  await world.addUser({ ...LISTED, google: true, onList: true });
  await world.addUser({ ...STRANGER, google: true, onList: false });
  // On the list by e-mail, but the only identity is an e-mail one: still not an admin.
  await world.addUser({ ...EMAIL_ONLY, google: false, onList: true });
});
afterAll(() => world.close());

const get = (token: string | null, app = world.app) =>
  app.fetch(
    new Request('https://api.test/storage', { headers: token === null ? {} : { authorization: `Bearer ${token}` } }),
    world.env,
  );

/** Captures every console channel while fn runs and returns what was written. */
async function captureLogs<T>(fn: () => Promise<T>): Promise<{ result: T; text: string }> {
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => undefined),
  );
  try {
    const result = await fn();
    const text = spies.flatMap((s) => s.mock.calls.flat()).map(String).join('\n');
    return { result, text };
  } finally {
    spies.forEach((s) => s.mockRestore());
  }
}

describe('admin sign-in: Worker authorization follows is_admin only', () => {
  it('allow-listed Google user gets 200', async () => {
    expect((await get(LISTED.token)).status).toBe(200);
  });

  it('Google user not on the list gets 403 NOT_ADMIN', async () => {
    const { result } = await captureLogs(() => get(STRANGER.token));
    expect(result.status).toBe(403);
    expect(await result.json()).toEqual({ error: 'NOT_ADMIN' });
  });

  it('user with only an e-mail identity gets 403 even when the address is listed', async () => {
    const { result } = await captureLogs(() => get(EMAIL_ONLY.token));
    expect(result.status).toBe(403);
    expect(await result.json()).toEqual({ error: 'NOT_ADMIN' });
  });

  it('malformed token gets 401 and costs no upstream call', async () => {
    const before = world.shim.calls.length;
    const { result } = await captureLogs(() => get('not-a-jwt'));
    expect(result.status).toBe(401);
    expect(world.shim.calls.length).toBe(before);
  });

  it('upstream failure gives 503, never a pass', async () => {
    for (const failing of [
      () => Promise.reject(new Error('network down')),
      () => Promise.resolve(new Response('boom', { status: 500 })),
    ]) {
      const app = createApp({ storage, fetch: failing });
      const { result } = await captureLogs(() => get(LISTED.token, app));
      expect(result.status).toBe(503);
    }
  });

  it('no token or e-mail address appears in captured logs', async () => {
    const failing = createApp({ storage, fetch: () => Promise.reject(new Error('network down')) });
    const { text } = await captureLogs(async () => {
      await get(LISTED.token);
      await get(STRANGER.token);
      await get(EMAIL_ONLY.token);
      await get('not-a-jwt');
      await get(null);
      await get(LISTED.token, failing);
    });
    expect(text).toContain('AUTH denied');
    for (const secret of [LISTED, STRANGER, EMAIL_ONLY]) {
      expect(text).not.toContain(secret.token);
      expect(text).not.toContain(secret.email);
      expect(text).not.toContain(secret.id);
    }
    expect(text).not.toContain('not-a-jwt');
    expect(text).not.toMatch(/bearer/i);
  });
});
