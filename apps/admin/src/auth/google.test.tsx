import { act, cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { FAKE_ADMIN, FAKE_OUTSIDER, createFakeWorld, type FakeWorld } from '../adapters/fake';
import { AppProviders } from '../AppProviders';
import { ApiError, NetworkError } from '../ports';
import { sanitizeReturnPath, storeReturnPath, takeReturnPath } from './returnPath';
import { useSession, type SessionValue } from './session';

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

/** Renders the provider tree and hands out the live session value. */
function harness(world: FakeWorld) {
  const current: { value: SessionValue | null } = { value: null };
  function Probe() {
    current.value = useSession();
    return <output data-testid="status">{current.value.status}</output>;
  }
  render(
    <AppProviders ports={world.ports} retry={false}>
      <MemoryRouter>
        <Probe />
      </MemoryRouter>
    </AppProviders>,
  );
  const session = () => current.value!;
  return { session };
}

describe('signInWithGoogle in the fake world', () => {
  it('signs the admin in by default', async () => {
    const world = createFakeWorld();
    const { session } = harness(world);
    await waitFor(() => expect(session().status).toBe('signedOut'));
    let result;
    await act(async () => {
      result = await session().signInWithGoogle({ returnTo: '/zverejnit' });
    });
    expect(result).toBe('ok');
    expect(session().status).toBe('ready');
    expect(world.snapshot().signedInAs).toBe(FAKE_ADMIN.email);
    expect(takeReturnPath()).toBe('/zverejnit');
    expect(takeReturnPath()).toBe('/');
  });

  it('an outsider is denied and signed out again', async () => {
    const world = createFakeWorld();
    const { session } = harness(world);
    await waitFor(() => expect(session().status).toBe('signedOut'));
    world.google.next = 'outsider';
    let result;
    await act(async () => {
      result = await session().signInWithGoogle();
    });
    expect(result).toBe('denied');
    expect(session().denied).toBe(true);
    expect(session().status).toBe('signedOut');
    expect(world.snapshot().signedInAs).toBeNull();
    expect(world.google.next).toBeNull();
  });

  it('cancel leaves the user signed out without a denial', async () => {
    const world = createFakeWorld();
    const { session } = harness(world);
    await waitFor(() => expect(session().status).toBe('signedOut'));
    world.google.next = 'cancel';
    let result;
    await act(async () => {
      result = await session().signInWithGoogle();
    });
    expect(result).toBe('cancelled');
    expect(session().denied).toBe(false);
    expect(session().status).toBe('signedOut');
    // The error is read once.
    expect(world.ports.auth.takeCallbackError()).toBeNull();
  });

  it('offline throws NetworkError and changes nothing', async () => {
    const world = createFakeWorld();
    const { session } = harness(world);
    await waitFor(() => expect(session().status).toBe('signedOut'));
    world.dropNetwork();
    await act(async () => {
      await expect(session().signInWithGoogle()).rejects.toBeInstanceOf(NetworkError);
    });
    expect(session().status).toBe('signedOut');
    expect(world.google.next).toBeNull();
  });

  it('the port reports the callback error once', async () => {
    const world = createFakeWorld();
    world.google.next = 'cancel';
    await world.ports.auth.signInWithGoogle({ returnTo: '/' });
    expect(world.ports.auth.takeCallbackError()).toBe('CANCELLED');
    expect(world.ports.auth.takeCallbackError()).toBeNull();
  });

  it('after expiry the same account re-signs in and the waiting action runs', async () => {
    const world = createFakeWorld({ signedIn: true });
    const { session } = harness(world);
    await waitFor(() => expect(session().status).toBe('ready'));
    act(() => world.expireSession());
    await waitFor(() => expect(session().status).toBe('expired'));
    let waiting!: Promise<string>;
    act(() => {
      waiting = session().runAuthed(async () => 'done');
    });
    await act(async () => {
      await session().signInWithGoogle({ returnTo: '/', loginHint: FAKE_ADMIN.email });
    });
    await expect(waiting).resolves.toBe('done');
    expect(session().status).toBe('ready');
  });

  it('a different account after expiry rejects the waiting actions', async () => {
    const other = { id: 'eeeeeeee-0000-4000-8000-000000000003', email: 'druhy@example.test', password: 'x', isAdmin: true } as const;
    const world = createFakeWorld({ signedIn: true, users: [{ ...FAKE_ADMIN }, { ...FAKE_OUTSIDER }, other] });
    const { session } = harness(world);
    await waitFor(() => expect(session().status).toBe('ready'));
    act(() => world.expireSession());
    await waitFor(() => expect(session().status).toBe('expired'));
    let ran = false;
    let waiting!: Promise<unknown>;
    act(() => {
      waiting = session().runAuthed(async () => {
        ran = true;
      });
    });
    const outcome = waiting.then(
      () => 'resolved',
      (error: unknown) => error,
    );
    world.google.next = other.email;
    await act(async () => {
      expect(await session().signInWithGoogle()).toBe('ok');
    });
    const error = await outcome;
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('UNAUTHENTICATED');
    expect(ran).toBe(false);
    expect(world.snapshot().signedInAs).toBe(other.email);
  });

  it('an outsider after expiry also rejects the waiting actions', async () => {
    const world = createFakeWorld({ signedIn: true });
    const { session } = harness(world);
    await waitFor(() => expect(session().status).toBe('ready'));
    act(() => world.expireSession());
    await waitFor(() => expect(session().status).toBe('expired'));
    let waiting!: Promise<unknown>;
    act(() => {
      waiting = session().runAuthed(async () => 'never');
    });
    const outcome = waiting.then(
      () => 'resolved',
      (error: unknown) => error,
    );
    world.google.next = 'outsider';
    await act(async () => {
      expect(await session().signInWithGoogle()).toBe('denied');
    });
    expect(await outcome).toBeInstanceOf(ApiError);
  });
});

describe('return path validation', () => {
  it.each([
    ['//evil.example', '/'],
    ['//x', '/'],
    ['https://evil.example/x', '/'],
    ['http://evil.example', '/'],
    ['javascript:alert(1)', '/'],
    ['/\\evil.example', '/'],
    ['zverejnit', '/'],
    ['', '/'],
    ['/prihlaseni', '/'],
    ['/prihlaseni?code=abc', '/'],
    ['/prihlaseni#x', '/'],
    ['/zverejnit', '/zverejnit'],
    ['/alba/123?tab=2', '/alba/123?tab=2'],
  ])('sanitizes %j to %j', (input, expected) => {
    expect(sanitizeReturnPath(input)).toBe(expected);
  });

  it('rejects non-strings', () => {
    expect(sanitizeReturnPath(undefined)).toBe('/');
    expect(sanitizeReturnPath(42)).toBe('/');
  });

  it('stores only the sanitized path and re-validates what it reads back', () => {
    expect(storeReturnPath('//x')).toBe('/');
    expect(sessionStorage.getItem('mp-admin-return-to')).toBe('/');
    sessionStorage.setItem('mp-admin-return-to', 'https://evil.example');
    expect(takeReturnPath()).toBe('/');
    expect(sessionStorage.getItem('mp-admin-return-to')).toBeNull();
  });

  it('signInWithGoogle stores a validated path, never a hostile one', async () => {
    const world = createFakeWorld();
    const { session } = harness(world);
    await waitFor(() => expect(session().status).toBe('signedOut'));
    await act(async () => {
      await session().signInWithGoogle({ returnTo: '//x' });
    });
    expect(takeReturnPath()).toBe('/');
  });
});
