import axe from 'axe-core';
import type { PublishLogRow } from '@mp/shared';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeWorld, createManualClock, type FakeWorld, type FakeWorldOptions } from '../adapters/fake';
import { App } from '../App';
import { AppProviders } from '../AppProviders';
import { cs } from '../i18n/cs';
import { formatPragueDateTime } from '../i18n/format';
import { ApiError } from '../ports';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const SITE = 'https://site.example.test';

/** A signed-in world on the manual clock with one published album (2 pending changes, like the world tests). */
async function makeWorld(options: FakeWorldOptions & { changes?: boolean } = {}) {
  const { changes = true, ...rest } = options;
  const clock = createManualClock();
  const world = createFakeWorld({ clock, signedIn: true, ...rest });
  if (changes) {
    const category = await world.ports.catalog.createCategory({ slug: 'svatby', name: 'Svatby' });
    await world.ports.catalog.createAlbum({ category_id: category.id, slug: 'one', title: 'One', published: true });
  }
  return { world, clock };
}

async function open(world: FakeWorld) {
  const view = render(
    <AppProviders ports={world.ports} retry={false} siteUrl={SITE}>
      <MemoryRouter initialEntries={['/zverejnit']}>
        <App />
      </MemoryRouter>
    </AppProviders>,
  );
  await screen.findByRole('heading', { level: 1, name: cs.routes.publish.title });
  await waitFor(() => expect(screen.getByRole('button', { name: cs.publish.button })).toBeTruthy());
  return view;
}

/** Moves the fake clock in 5 s steps and lets every poll finish in between. */
async function advance(clock: ReturnType<typeof createManualClock>, ms: number) {
  for (let left = ms; left > 0; left -= 5_000) {
    await act(async () => {
      await clock.advance(Math.min(5_000, left));
      for (let i = 0; i < 30; i++) await Promise.resolve();
    });
  }
}

const button = () => screen.getByRole('button', { name: /Zveřejnit web|Zveřejňuji…/ });
const publishRows = () => within(screen.getByRole('list', { name: cs.publish.historyLabel })).getAllByRole('listitem');

describe('publish screen', () => {
  it('full sequence: pending count, busy button, building text, polling every 5 s, done with a link, indicator cleared', async () => {
    const { world, clock } = await makeWorld();
    const pending = world.snapshot().site.pending_changes;
    expect(pending).toBeGreaterThan(0);
    const read = vi.spyOn(world.ports.publishStatus, 'read');
    await open(world);
    expect(screen.getByText(new RegExp(`^${pending} úpr.* od posledního zveřejnění$`))).toBeTruthy();
    expect(screen.getByText(cs.publish.neverPublished)).toBeTruthy();
    expect((button() as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(cs.publish.historyEmpty)).toBeTruthy();

    await userEvent.setup().click(button());
    expect(button().textContent).toBe(cs.publish.busy);
    expect(await screen.findByText(cs.publish.building)).toBeTruthy();
    expect(screen.queryByRole('link', { name: cs.publish.showSite })).toBeNull();

    // The build takes 90 s: polls at 5, 10, ... 85 s see nothing new.
    await advance(clock, 85_000);
    expect(read).toHaveBeenCalledTimes(17);
    expect(screen.queryByText(cs.publish.done)).toBeNull();
    expect(button().textContent).toBe(cs.publish.busy);

    await advance(clock, 5_000);
    expect(await screen.findByText(cs.publish.done)).toBeTruthy();
    expect(read).toHaveBeenCalledTimes(18);
    const link = screen.getByRole('link', { name: cs.publish.showSite });
    expect(link.getAttribute('href')).toBe(SITE);
    expect(button().textContent).toBe(cs.publish.button);

    // Polling stopped, and the publish indicator and pending count were refreshed.
    await advance(clock, 30_000);
    expect(read).toHaveBeenCalledTimes(18);
    expect(clock.pending()).toBe(0);
    expect(world.snapshot().site.pending_changes).toBe(0);
    await waitFor(() => expect(screen.getByText(cs.publish.noChanges)).toBeTruthy());
    expect(document.querySelector('[data-pending="true"]')).toBeNull();

    // History: one row, Prague time (08:00 UTC on 2026-10-20 is 10:00 summer time), Czech status and counts.
    const rows = publishRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain('20. 10. 2026 10:00');
    expect(rows[0]!.textContent).toContain(cs.publish.log.ok);
    expect(rows[0]!.textContent).toContain('1 album, 0 fotek');
    expect(screen.getByText(/^Naposledy zveřejněno 20\. 10\. 2026 10:00$/)).toBeTruthy();
  });

  it('a repeated press while publishing says so and sends nothing', async () => {
    const { world, clock } = await makeWorld();
    const publish = vi.spyOn(world.ports.api, 'publish');
    await open(world);
    const user = userEvent.setup();
    await user.click(button());
    await screen.findByText(cs.publish.building);
    await user.click(button());
    expect(await screen.findByText(cs.publish.alreadyRunning)).toBeTruthy();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(button().getAttribute('aria-disabled')).toBe('true');
    await advance(clock, 90_000);
    await screen.findByText(cs.publish.done);
    expect(screen.queryByText(cs.publish.alreadyRunning)).toBeNull();
  });

  it('PUBLISH_TOO_SOON shows the seconds left', async () => {
    const { world } = await makeWorld();
    world.failNext('api.publish', new ApiError('PUBLISH_TOO_SOON', { retryAfter: 42 }));
    await open(world);
    await userEvent.setup().click(button());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Web se právě zveřejnil. Zkuste to znovu za 42 sekund.');
    expect(button().textContent).toBe(cs.publish.button);
  });

  it('PUBLISH_FAILED and a 502 keep the old site and offer a retry; the failed row shows in the history', async () => {
    const { world, clock } = await makeWorld();
    world.failNext('api.publish', new ApiError('PUBLISH_FAILED'));
    await open(world);
    const user = userEvent.setup();
    await user.click(button());
    expect((await screen.findByRole('alert')).textContent).toBe(cs.publish.failed);
    await waitFor(() => expect(publishRows()[0]!.textContent).toContain(cs.publish.log.failed));
    expect(world.snapshot().site.pending_changes).toBeGreaterThan(0);

    // A bare 502 reads the same.
    await advance(clock, 60_000);
    world.failNext('api.publish', new ApiError('UPSTREAM_ERROR', { status: 502 }));
    await user.click(button());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(cs.publish.failed));
  });

  it('SNAPSHOT_EMPTY: nothing is published without a published album', async () => {
    const { world } = await makeWorld();
    const album = (world.snapshot().albums as { id: string }[])[0]!;
    await world.ports.catalog.updateAlbum(album.id, { published: false });
    await open(world);
    await userEvent.setup().click(button());
    expect((await screen.findByRole('alert')).textContent).toBe('Nelze zveřejnit web bez jediného zveřejněného alba.');
  });

  it('after 6 minutes without the new snapshot it says the site has not updated, and stops polling', async () => {
    const { world, clock } = await makeWorld({ buildDelayMs: null });
    const read = vi.spyOn(world.ports.publishStatus, 'read');
    await open(world);
    await userEvent.setup().click(button());
    await screen.findByText(cs.publish.building);
    await advance(clock, 355_000);
    expect(screen.queryByRole('alert')).toBeNull();
    await advance(clock, 5_000);
    expect((await screen.findByRole('alert')).textContent).toBe(cs.publish.timeout);
    expect(cs.publish.timeout.startsWith('Web se zatím neaktualizoval')).toBe(true);
    expect(read).toHaveBeenCalledTimes(72);
    await advance(clock, 60_000);
    expect(read).toHaveBeenCalledTimes(72);
    expect(button().textContent).toBe(cs.publish.button);
  });

  it('an unreadable /_publish.json (CORS) degrades to "build triggered" without an error', async () => {
    const { world, clock } = await makeWorld();
    world.failNext('publishStatus.read', 'network');
    const read = vi.spyOn(world.ports.publishStatus, 'read');
    await open(world);
    await userEvent.setup().click(button());
    await screen.findByText(cs.publish.building);
    await advance(clock, 5_000);
    expect(await screen.findByText(cs.publish.triggered)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
    await advance(clock, 30_000);
    expect(read).toHaveBeenCalledTimes(1);
    expect(button().textContent).toBe(cs.publish.button);
  });

  it('with no pending changes the button is disabled and says "Žádné nové změny."', async () => {
    const { world } = await makeWorld({ changes: false });
    await open(world);
    expect((button() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Žádné nové změny.')).toBeTruthy();
    expect(screen.queryByText(/od posledního zveřejnění$/)).toBeNull();
  });

  it('leaving the screen stops the polling and leaves no timer behind', async () => {
    const { world, clock } = await makeWorld();
    const read = vi.spyOn(world.ports.publishStatus, 'read');
    const view = await open(world);
    await userEvent.setup().click(button());
    await screen.findByText(cs.publish.building);
    await advance(clock, 15_000);
    expect(read).toHaveBeenCalledTimes(3);
    view.unmount();
    expect(clock.pending()).toBe(0);
    await advance(clock, 120_000);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('the history lists the last 10 publishes, newest first', async () => {
    const { world, clock } = await makeWorld();
    for (let i = 0; i < 12; i++) {
      await world.ports.api.publish();
      await clock.advance(61_000);
    }
    await open(world);
    await waitFor(() => expect(publishRows()).toHaveLength(10));
    const times = (world.snapshot().publishLog as PublishLogRow[]).map((r) => r.requested_at).sort().reverse();
    expect(publishRows()[0]!.textContent).toContain(formatPragueDateTime(times[0]!));
    expect(publishRows()[9]!.textContent).toContain(formatPragueDateTime(times[9]!));
  });

  it('has no accessibility violations in the idle and done states', async () => {
    const { world, clock } = await makeWorld();
    const view = await open(world);
    const check = async () => {
      const result = await axe.run(view.container, { rules: { 'color-contrast': { enabled: false } } });
      expect(result.violations.map((v) => v.id)).toEqual([]);
    };
    await check();
    await userEvent.setup().click(button());
    await screen.findByText(cs.publish.building);
    await advance(clock, 90_000);
    await screen.findByText(cs.publish.done);
    await check();
  });
});

describe('Prague time', () => {
  it('uses CET in winter and CEST in summer, whatever the browser zone is', () => {
    expect(formatPragueDateTime('2026-01-15T12:05:00Z')).toBe('15. 1. 2026 13:05');
    expect(formatPragueDateTime('2026-07-01T12:05:00Z')).toBe('1. 7. 2026 14:05');
    expect(formatPragueDateTime('2026-03-29T00:59:00Z')).toBe('29. 3. 2026 01:59');
    expect(formatPragueDateTime('2026-03-29T01:00:00Z')).toBe('29. 3. 2026 03:00');
    expect(formatPragueDateTime('2026-10-25T00:59:00Z')).toBe('25. 10. 2026 02:59');
    expect(formatPragueDateTime('2026-10-25T01:00:00Z')).toBe('25. 10. 2026 02:00');
    expect(formatPragueDateTime('not a date')).toBe('');
  });
});
