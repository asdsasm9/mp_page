import axe from 'axe-core';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeWorld, fixtureSnapshot, type FakeWorld } from '../adapters/fake';
import { AppProviders } from '../AppProviders';
import { LoginPage } from '../auth/LoginPage';
import { RequireAuth } from '../auth/RequireAuth';
import { AuthLayout, ShellLayout } from '../components/Layouts';
import { LoadFailure } from '../components/LoadFailure';
import { StaleNotice } from '../components/StaleNotice';
import { cs, glossary } from '../i18n/cs';
import { errorMessage } from '../i18n/messages';
import { ApiError, CatalogError, NetworkError } from '../ports';
import { useAlbum, useCategories, useUpdateAlbum } from './catalog';
import { expectUpdatedAt, isStale } from './concurrency';
import { useCanMutate } from './health';
import { shouldRetry } from './queryClient';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });
  act(() => {
    window.dispatchEvent(new Event(online ? 'online' : 'offline'));
  });
}

function Screen({ albumId }: { albumId: string }) {
  const categories = useCategories();
  const album = useAlbum(albumId);
  const update = useUpdateAlbum();
  const canMutate = useCanMutate();
  return (
    <div>
      <h1>Ukazka</h1>
      {categories.isError ? <LoadFailure error={categories.error} onRetry={() => void categories.refetch()} /> : null}
      <ul>{categories.data?.map((c) => <li key={c.id}>{c.name}</li>)}</ul>
      <p data-testid="title">{album.data?.title ?? ''}</p>
      <button
        type="button"
        disabled={!canMutate || !album.data}
        onClick={() =>
          update.mutate({ id: albumId, patch: { title: 'Zmeneno' }, options: expectUpdatedAt(album.data!) })
        }
      >
        Zmenit
      </button>
      {update.isSuccess ? <p>Hotovo ulozeno</p> : null}
      {update.error && isStale(update.error) ? <StaleNotice /> : null}
      {update.error && !isStale(update.error) ? <p role="alert">{errorMessage(update.error)}</p> : null}
    </div>
  );
}

function setup() {
  const world = createFakeWorld({ signedIn: true, seed: fixtureSnapshot() });
  const albumId = (world.snapshot().albums[0] as { id: string }).id;
  const view = render(
    <AppProviders ports={world.ports} retry={false}>
      <MemoryRouter>
        <Routes>
          <Route element={<AuthLayout />}>
            <Route path="/prihlaseni" element={<LoginPage />} />
          </Route>
          <Route element={<RequireAuth />}>
            <Route element={<ShellLayout />}>
              <Route path="/" element={<Screen albumId={albumId} />} />
            </Route>
          </Route>
        </Routes>
      </MemoryRouter>
    </AppProviders>,
  );
  return { world, albumId, ...view };
}

const titleOf = (world: FakeWorld, id: string) =>
  (world.snapshot().albums.find((a) => (a as { id: string }).id === id) as { title: string }).title;

describe('catalog hooks', () => {
  it('load through the ports once the session is ready', async () => {
    const { world } = setup();
    const names = (world.snapshot().categories as { name: string }[]).map((c) => c.name);
    await screen.findByText(names[0]!);
    for (const n of names) expect(screen.getByText(n)).toBeTruthy();
  });

  it('a mutation saves and the lists refresh', async () => {
    const user = userEvent.setup();
    const { world, albumId } = setup();
    await waitFor(() => expect(screen.getByTestId('title').textContent).not.toBe(''));
    await user.click(screen.getByRole('button', { name: 'Zmenit' }));
    await screen.findByText('Hotovo ulozeno');
    expect(titleOf(world, albumId)).toBe('Zmeneno');
    await waitFor(() => expect(screen.getByTestId('title').textContent).toBe('Zmeneno'));
  });
});

describe('load failure', () => {
  it('shows the sentence, a retry and the code only under Podrobnosti; retry recovers', async () => {
    const user = userEvent.setup();
    const world = createFakeWorld({ signedIn: true, seed: fixtureSnapshot() });
    world.failNext('catalog.listCategories', new ApiError('INTERNAL'));
    const albumId = (world.snapshot().albums[0] as { id: string }).id;
    render(
      <AppProviders ports={world.ports} retry={false}>
        <MemoryRouter>
          <Routes>
            <Route element={<RequireAuth />}>
              <Route path="/" element={<Screen albumId={albumId} />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AppProviders>,
    );
    const block = await screen.findByRole('alert');
    expect(within(block).getByText(cs.data.loadFailed)).toBeTruthy();
    const details = block.querySelector('details')!;
    expect(details.textContent).toContain('INTERNAL');
    expect(details.open).toBe(false);
    expect(block.textContent?.replace(details.textContent ?? '', '')).not.toContain('INTERNAL');
    await user.click(within(block).getByRole('button', { name: glossary.retry }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0);
  });

  it('has no serious axe violations', async () => {
    const { container } = render(<LoadFailure error={new NetworkError()} onRetry={() => undefined} />);
    const result = await axe.run(container, {
      runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
      rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
    });
    expect(result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
  });
});

describe('banners', () => {
  it('offline: banner text, mutating control disabled, no write when forced', async () => {
    const { world, albumId } = setup();
    await waitFor(() => expect(screen.getByTestId('title').textContent).not.toBe(''));
    expect(screen.queryByText(cs.data.offline)).toBeNull();
    setOnline(false);
    expect(await screen.findByText('Jste offline. Změny se neuloží.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Zmenit' }) as HTMLButtonElement).disabled).toBe(true);
    expect(titleOf(world, albumId)).not.toBe('Zmeneno');
    setOnline(true);
    await waitFor(() => expect(screen.queryByText(cs.data.offline)).toBeNull());
    expect((screen.getByRole('button', { name: 'Zmenit' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('a mutation started offline is refused without reaching the port', async () => {
    const { world } = setup();
    await waitFor(() => expect(screen.getByTestId('title').textContent).not.toBe(''));
    const spy = vi.spyOn(world.ports.catalog, 'updateAlbum');
    const button = screen.getByRole('button', { name: 'Zmenit' }) as HTMLButtonElement;
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    button.disabled = false; // as if a stale click got through
    button.click();
    expect((await screen.findByRole('alert')).textContent).toBe('Chybí připojení k internetu.');
    expect(spy).not.toHaveBeenCalled();
  });

  it('a back end that is down shows the unavailable banner with a retry that clears it', async () => {
    const user = userEvent.setup();
    const world = createFakeWorld({ signedIn: true, seed: fixtureSnapshot() });
    world.failNext('catalog.listCategories', new ApiError('UPSTREAM_ERROR'));
    const albumId = (world.snapshot().albums[0] as { id: string }).id;
    render(
      <AppProviders ports={world.ports} retry={false}>
        <MemoryRouter>
          <Routes>
            <Route element={<RequireAuth />}>
              <Route element={<ShellLayout />}>
                <Route path="/" element={<Screen albumId={albumId} />} />
              </Route>
            </Route>
          </Routes>
        </MemoryRouter>
      </AppProviders>,
    );
    const text = await screen.findByText('Správa je dočasně nedostupná. Veřejný web funguje dál.');
    const banner = text.closest('.banner') as HTMLElement;
    await user.click(within(banner).getByRole('button', { name: glossary.retry }));
    await waitFor(() => expect(screen.queryByText(cs.data.unavailable)).toBeNull());
    expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0);
  });

  it('a request that gets no answer while the browser is online also counts as unavailable', async () => {
    const world = createFakeWorld({ signedIn: true, seed: fixtureSnapshot() });
    world.failNext('catalog.listCategories', 'network');
    const albumId = (world.snapshot().albums[0] as { id: string }).id;
    render(
      <AppProviders ports={world.ports} retry={false}>
        <MemoryRouter>
          <Routes>
            <Route element={<RequireAuth />}>
              <Route element={<ShellLayout />}>
                <Route path="/" element={<Screen albumId={albumId} />} />
              </Route>
            </Route>
          </Routes>
        </MemoryRouter>
      </AppProviders>,
    );
    await screen.findByText(cs.data.unavailable);
  });
});

describe('concurrency', () => {
  it('a save based on an old updated_at is refused with the Czech sentence and reload recovers', async () => {
    const user = userEvent.setup();
    const { world, albumId } = setup();
    await waitFor(() => expect(screen.getByTestId('title').textContent).not.toBe(''));
    // Another device changes the album after this screen loaded it.
    await world.ports.catalog.updateAlbum(albumId, { title: 'Jinde' });
    await user.click(screen.getByRole('button', { name: 'Zmenit' }));
    const notice = await screen.findByRole('alert');
    expect(notice.textContent).toBe(`${cs.data.staleSentence}${cs.data.reload}`);
    expect(errorMessage(new CatalogError('STALE'))).toBe('Toto album bylo změněno jinde. Načíst znovu.');
    expect(titleOf(world, albumId)).toBe('Jinde');
    await user.click(within(notice).getByRole('button', { name: cs.data.reload }));
    await waitFor(() => expect(screen.getByTestId('title').textContent).toBe('Jinde'));
  });
});

describe('logout', () => {
  it('clears the cache: the next session reads again', async () => {
    const user = userEvent.setup();
    const { world } = setup();
    const spy = vi.spyOn(world.ports.catalog, 'listCategories');
    await waitFor(() => expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0));
    expect(spy).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: glossary.logOut }));
    await user.click(await screen.findByRole('button', { name: cs.login.google.button }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2)); // inside staleTime, so only a cleared cache reads again
    await waitFor(() => expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0));
  });
});

describe('retry policy', () => {
  it('retries what can heal and nothing else', () => {
    expect(shouldRetry(0, new NetworkError())).toBe(true);
    expect(shouldRetry(1, new ApiError('UPSTREAM_ERROR'))).toBe(true);
    expect(shouldRetry(0, new ApiError('PUBLISH_TOO_SOON', { retryAfter: 3 }))).toBe(true); // 429
    expect(shouldRetry(2, new NetworkError())).toBe(false);
    expect(shouldRetry(0, new ApiError('UNAUTHENTICATED'))).toBe(false);
    expect(shouldRetry(0, new ApiError('NOT_ADMIN'))).toBe(false);
    expect(shouldRetry(0, new ApiError('INVALID_REQUEST'))).toBe(false);
    expect(shouldRetry(0, new ApiError('NOT_FOUND'))).toBe(false);
    expect(shouldRetry(0, new CatalogError('STALE'))).toBe(false);
    expect(shouldRetry(0, new CatalogError('DUPLICATE_SLUG'))).toBe(false);
  });
});
