import axe from 'axe-core';
import { useQueryClient } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync, readdirSync } from 'node:fs';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeWorld, fixtureSnapshot, type FakeWorld } from '../adapters/fake';
import { AppProviders } from '../AppProviders';
import { RequireAuth } from '../auth/RequireAuth';
import { ShellLayout } from '../components/Layouts';
import { Placeholder } from '../components/Page';
import { StaleNotice } from '../components/StaleNotice';
import { cs } from '../i18n/cs';
import { formatBytes } from '../i18n/format';
import { useUpdateAlbum } from './catalog';
import { refreshStorageAndSite, useDeletePhotos } from './storage';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function Actions({ albumId, photoIds }: { albumId: string; photoIds: string[] }) {
  const update = useUpdateAlbum();
  const del = useDeletePhotos();
  const queryClient = useQueryClient();
  return (
    <div>
      <button type="button" onClick={() => void refreshStorageAndSite(queryClient)}>
        refresh
      </button>
      <button type="button" onClick={() => update.mutate({ id: albumId, patch: { title: 'Zmeneno' } })}>
        edit
      </button>
      <button type="button" onClick={() => del.mutate({ ids: photoIds })}>
        delete
      </button>
    </div>
  );
}

function setup(world: FakeWorld = createFakeWorld({ signedIn: true, seed: fixtureSnapshot() })) {
  const snapshot = world.snapshot();
  const albumId = (snapshot.albums[0] as { id: string }).id;
  const photoIds = (snapshot.photos as { id: string }[]).slice(0, 3).map((p) => p.id);
  const view = render(
    <AppProviders ports={world.ports} retry={false}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<RequireAuth />}>
            <Route element={<ShellLayout />}>
              <Route
                path="/"
                element={
                  <>
                    <Placeholder title={cs.routes.categories.title} storageBar />
                    <Actions albumId={albumId} photoIds={photoIds} />
                  </>
                }
              />
            </Route>
          </Route>
        </Routes>
      </MemoryRouter>
    </AppProviders>,
  );
  return { world, albumId, photoIds, ...view };
}

const mini = () => document.querySelector('.storage-mini') as HTMLElement;
const large = () => document.querySelector('.storage-large') as HTMLElement;

describe('storage bar', () => {
  it('ok: shows exactly what GET /storage returns, no role on the sentence', async () => {
    const world = createFakeWorld({ signedIn: true, seed: fixtureSnapshot() });
    const s = await world.ports.api.getStorage();
    expect(s.level).toBe('ok');
    setup(world);
    const line = `Úložiště ${formatBytes(s.used_bytes)} z ${formatBytes(s.hard)}`;
    await waitFor(() => expect(mini().textContent).toContain(line));
    expect(large().querySelector('.storage-text')!.textContent).toBe(line);
    expect(large().querySelector('.storage-text')!.getAttribute('role')).toBeNull();
    const meter = large().querySelector('progress')!;
    expect(meter.max).toBe(s.hard);
    expect(meter.value).toBe(s.used_bytes);
    expect(mini().getAttribute('href')).toBe('/ulozeni');
  });

  it('warn: the sentence with the numbers from the response, role=status, state word in the mini bar', async () => {
    const world = createFakeWorld({ signedIn: true, seed: fixtureSnapshot() });
    const used = (await world.ports.api.getStorage()).used_bytes;
    world.setLimits({ quotaWarnBytes: Math.max(used - 1, 0), quotaHardBytes: used + 1_000_000 });
    const s = await world.ports.api.getStorage();
    expect(s.level).toBe('warn');
    setup(world);
    const sentence = `Úložiště se plní (${formatBytes(s.used_bytes)} z ${formatBytes(s.hard)}). Zvažte smazání nepotřebných fotek.`;
    const text = await waitFor(() => {
      const el = large().querySelector('.storage-text') as HTMLElement;
      expect(el.textContent).toBe(sentence);
      return el;
    });
    expect(text.getAttribute('role')).toBe('status');
    expect(mini().textContent).toContain(cs.storage.warnShort);
    expect(mini().querySelector('progress')!.getAttribute('data-level')).toBe('warn');
  });

  it('full: the sentence and role=alert', async () => {
    const world = createFakeWorld({ signedIn: true, seed: fixtureSnapshot() });
    const used = (await world.ports.api.getStorage()).used_bytes;
    world.setLimits({ quotaWarnBytes: 1, quotaHardBytes: Math.max(used, 2) });
    expect((await world.ports.api.getStorage()).level).toBe('full');
    setup(world);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Úložiště je plné. Nahrávání je zastaveno.');
    expect(mini().textContent).toContain(cs.storage.fullShort);
  });

  it('a failed load says so instead of showing a number', async () => {
    const world = createFakeWorld({ signedIn: true, seed: fixtureSnapshot() });
    world.failNext('api.getStorage', 'network', 5);
    setup(world);
    await waitFor(() => expect(large().textContent).toBe(cs.storage.loadFailed));
  });

  it('refreshes after a photo delete (the bar goes down)', async () => {
    const user = userEvent.setup();
    const { world, photoIds } = setup();
    const before = await world.ports.api.getStorage();
    await waitFor(() => expect(large().querySelector('.storage-text')!.textContent).toContain(formatBytes(before.used_bytes)));
    await user.click(screen.getByRole('button', { name: 'delete' }));
    const after = await world.ports.api.getStorage();
    expect(after.used_bytes).toBeLessThan(before.used_bytes);
    expect(photoIds.length).toBe(3);
    await waitFor(() =>
      expect(large().querySelector('.storage-text')!.textContent).toBe(
        `Úložiště ${formatBytes(after.used_bytes)} z ${formatBytes(after.hard)}`,
      ),
    );
  });

  it('refreshes every 60 s while the page is visible', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const world = createFakeWorld({ signedIn: true, seed: fixtureSnapshot() });
    const spy = vi.spyOn(world.ports.api, 'getStorage');
    setup(world);
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(59_000);
    expect(spy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    // Two bars share one request.
    expect(document.querySelectorAll('.storage').length).toBe(2);
  });

  it('has no serious axe violations (shell with both bars)', async () => {
    setup();
    await waitFor(() => expect(large().querySelector('progress')).not.toBeNull());
    const result = await axe.run(document.body, {
      runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
      rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
    });
    expect(result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
  });
});

describe('publish indicator', () => {
  it('shows a dot and "Nezveřejněné změny" only while changes are pending', async () => {
    const user = userEvent.setup();
    const { world } = setup();
    await waitFor(() => expect(world.snapshot().site.pending_changes).toBe(0));
    await screen.findAllByRole('link', { name: cs.nav.publishSite });
    expect(screen.queryByText(cs.publishIndicator.pending)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'edit' }));
    const labels = await screen.findAllByText('Nezveřejněné změny');
    expect(labels.length).toBe(2); // desktop and phone navigation
    expect(world.snapshot().site.pending_changes).toBeGreaterThan(0);
    const desktop = screen.getByRole('navigation', { name: cs.nav.main });
    const link = within(desktop).getByRole('link', { name: `${cs.nav.publishSite}${cs.publishIndicator.pending}` });
    expect(link.querySelector('.pending-dot')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('the dot disappears after publishing', async () => {
    const user = userEvent.setup();
    const { world } = setup();
    await user.click(await screen.findByRole('button', { name: 'edit' }));
    await screen.findAllByText('Nezveřejněné změny');
    await world.ports.api.publish();
    expect(world.snapshot().site.pending_changes).toBe(0);
    await user.click(screen.getByRole('button', { name: 'refresh' }));
    await waitFor(() => expect(screen.queryAllByText('Nezveřejněné změny')).toEqual([]));
  });
});

describe('stale notice', () => {
  it.each([
    ['album', 'Toto album bylo změněno jinde.'],
    ['category', 'Tato kategorie byla změněna jinde.'],
    ['photo', 'Tato fotka byla změněna jinde.'],
  ] as const)('names the %s', (entity, sentence) => {
    render(
      <AppProviders ports={createFakeWorld({ signedIn: true }).ports} retry={false}>
        <StaleNotice entity={entity} />
      </AppProviders>,
    );
    expect(screen.getByRole('alert').textContent).toBe(`${sentence}${cs.data.reload}`);
  });
});

describe('no limit literals in src', () => {
  const srcDir = `${import.meta.dirname}/..`;
  const files = (readdirSync(srcDir, { recursive: true }) as string[]).filter(
    (f) =>
      /\.(ts|tsx)$/.test(f) &&
      !/\.test\.(ts|tsx)$/.test(f) &&
      // The fake world is the stand-in for the server: it is where the configured limits live in tests.
      !f.replaceAll('\\', '/').startsWith('adapters/fake/'),
  );

  it('finds the source files', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(files)('%s has no quota number, limit name or hard-coded GB size', (file) => {
    const source = readFileSync(`${srcDir}/${file}`, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(source).not.toMatch(/\b9[.,]5\b/);
    expect(source).not.toMatch(/9_?500_?000_?000|8_?000_?000_?000|9_?000_?000_?000/);
    expect(source).not.toMatch(/\b(8|9|10)\s*GB\b/);
    expect(source).not.toMatch(/DEFAULT_LIMITS|quotaHardBytes|quotaWarnBytes|QUOTA_/);
  });
});
