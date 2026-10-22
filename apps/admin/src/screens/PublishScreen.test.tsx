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
import { CHANGES_SHOWN } from './ChangesDialog';

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
  // The heading and button render before the site-state read resolves (the button is just disabled and the
  // status line says "loading"), so wait for that read; otherwise assertions race it under load.
  const status = await screen.findByRole('region', { name: cs.publish.statusLabel });
  await waitFor(() => expect(within(status).queryByText(cs.data.loading)).toBeNull());
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
    // Pending state: flag with the same words as the header dot, primary button.
    expect(document.querySelector('.publish-card')!.getAttribute('data-state')).toBe('pending');
    expect(document.querySelector('.publish-flag')!.textContent).toBe(cs.publishIndicator.pending);
    expect(button().className).toContain('button-primary');
    expect(await screen.findByText(cs.publish.historyEmpty)).toBeTruthy();

    await userEvent.setup().click(button());
    expect(button().textContent).toBe(cs.publish.busy);
    expect(await screen.findByText(cs.publish.building)).toBeTruthy();
    expect(screen.queryByRole('link', { name: cs.publish.showSite })).toBeNull();

    // The build takes 90 s: polls at 5, 10, ... 85 s see nothing new.
    await advance(clock, 85_000);
    await waitFor(() => expect(read).toHaveBeenCalledTimes(17));
    expect(screen.queryByText(cs.publish.done)).toBeNull();
    expect(button().textContent).toBe(cs.publish.busy);

    await advance(clock, 5_000);
    expect(await screen.findByText(cs.publish.done)).toBeTruthy();
    await waitFor(() => expect(read).toHaveBeenCalledTimes(18));
    const link = screen.getByRole('link', { name: cs.publish.showSite });
    expect(link.getAttribute('href')).toBe(SITE);
    expect(button().textContent).toBe(cs.publish.button);

    // Polling stopped, and the publish indicator and pending count were refreshed.
    await advance(clock, 30_000);
    expect(read).toHaveBeenCalledTimes(18);
    await waitFor(() => expect(clock.pending()).toBe(0));
    expect(world.snapshot().site.pending_changes).toBe(0);
    await waitFor(() => expect(screen.getByText(cs.publish.noChanges)).toBeTruthy());
    expect(document.querySelector('[data-pending="true"]')).toBeNull();
    expect(document.querySelector('.publish-card')!.getAttribute('data-state')).toBe('clean');
    expect(button().className).not.toContain('button-primary');

    // History: one row, Prague time (08:00 UTC on 2026-10-20 is 10:00 summer time), Czech status and counts.
    const rows = publishRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain('20. 10. 2026 10:00');
    expect(rows[0]!.textContent).toContain(cs.publish.log.ok);
    expect(rows[0]!.textContent).toContain('1 album, 0 fotek');
    expect(screen.getByText(/^Naposledy zveřejněno 20\. 10\. 2026 10:00$/)).toBeTruthy();
  }, 60_000);

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
  }, 60_000);

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
  }, 60_000);
});

describe('list of unpublished changes (T-251)', () => {
  const showButton = () => screen.getByRole('button', { name: cs.publish.showChanges });
  const dialog = () => screen.getByRole('dialog');
  const lines = () => within(dialog()).queryAllByRole('listitem');

  /** Two categories, two albums, photos: a realistic mix of kinds. */
  async function richWorld() {
    const { world, clock } = await makeWorld({ changes: false });
    const c = world.ports.catalog;
    const wedding = await c.createCategory({ slug: 'svatby', name: 'Svatby' });
    const portraits = await c.createCategory({ slug: 'portrety', name: 'Portréty' });
    const a1 = await c.createAlbum({ category_id: wedding.id, slug: 'novakovi', title: 'Novákovi', published: true });
    await c.createAlbum({ category_id: portraits.id, slug: 'studio', title: 'Studio', published: true });
    await world.ports.api.publish();
    await clock.advance(61_000);
    // After the publish: an edit, a rename and a reorder.
    await c.updateAlbum(a1.id, { title: 'Novákovi 2026' });
    await c.updateCategory(portraits.id, { sort: 50 });
    return { world, clock, wedding, portraits, a1 };
  }

  it('the number equals the lines of the dialog, grouped by category and album with Czech kinds', async () => {
    const { world } = await richWorld();
    await open(world);
    expect(screen.getByText(/^2 úpravy od posledního zveřejnění$/)).toBeTruthy();
    await userEvent.setup().click(showButton());
    expect(dialog().getAttribute('aria-labelledby')).toBeTruthy();
    expect(within(dialog()).getByRole('heading', { level: 2, name: cs.publish.changes.title })).toBeTruthy();
    expect(lines()).toHaveLength(2);
    const headings = within(dialog()).getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(['Portréty', 'Svatby']); // newest change first
    expect(lines().map((l) => l.textContent)).toEqual([
      'Kategorie Portréty změněno pořadí',
      'Album Novákovi 2026 upraveno',
    ]);
    expect(within(dialog()).getByRole('heading', { level: 4, name: 'Novákovi 2026' })).toBeTruthy();
  });

  it('the dialog count always equals the number shown on the panel, including photos and deletes', async () => {
    const { world, a1 } = await richWorld();
    await world.ports.catalog.deleteAlbum((world.snapshot().albums as { id: string; title: string }[]).find((a) => a.title === 'Studio')!.id);
    await world.ports.catalog.updateAlbum(a1.id, { sort: 99 });
    await open(world);
    const n = world.snapshot().changeLog.length;
    expect(screen.getByText(new RegExp(`^${n} úpr.* od posledního zveřejnění$`))).toBeTruthy();
    await userEvent.setup().click(showButton());
    expect(lines()).toHaveLength(n);
    expect(lines().map((l) => l.textContent)).toContain('Album Studio smazáno');
  });

  it('keyboard: focus moves into the dialog, Escape closes it and focus returns to the button', async () => {
    const { world } = await richWorld();
    await open(world);
    const user = userEvent.setup();
    showButton().focus();
    await user.keyboard('{Enter}');
    expect(dialog().contains(document.activeElement)).toBe(true);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(showButton());
  });

  it('the Close button closes it', async () => {
    const { world } = await richWorld();
    await open(world);
    const user = userEvent.setup();
    await user.click(showButton());
    await user.click(within(dialog()).getByRole('button', { name: cs.publish.changes.close }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('with nothing unpublished the dialog shows the empty state', async () => {
    const { world } = await makeWorld({ changes: false });
    await open(world);
    await userEvent.setup().click(showButton());
    expect(within(dialog()).getByText(cs.publish.changes.empty)).toBeTruthy();
    expect(lines()).toHaveLength(0);
  });

  it('a long list is limited and ends with "a dalších N"', async () => {
    const { world } = await makeWorld({ changes: false });
    const category = await world.ports.catalog.createCategory({ slug: 'svatby', name: 'Svatby' });
    for (let i = 0; i < CHANGES_SHOWN + 7; i++) {
      await world.ports.catalog.createAlbum({ category_id: category.id, slug: `album-${i}`, title: `Album ${i}` });
    }
    await open(world);
    const total = CHANGES_SHOWN + 8;
    expect(screen.getByText(new RegExp(`^${total} úprav od posledního zveřejnění$`))).toBeTruthy();
    await userEvent.setup().click(showButton());
    expect(lines()).toHaveLength(CHANGES_SHOWN);
    expect(within(dialog()).getByText('a dalších 8')).toBeTruthy();
  });

  it('a successful publish empties the list and the count', async () => {
    const { world, clock } = await richWorld();
    await open(world);
    await userEvent.setup().click(button());
    await screen.findByText(cs.publish.building);
    await advance(clock, 90_000);
    await screen.findByText(cs.publish.done);
    await waitFor(() => expect(screen.getByText(cs.publish.noChanges)).toBeTruthy());
    expect(world.snapshot().changeLog).toEqual([]);
  }, 60_000);

  it('has no accessibility violations with the dialog open', async () => {
    const { world } = await richWorld();
    await open(world);
    await userEvent.setup().click(showButton());
    const result = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } });
    expect(result.violations.map((v) => v.id)).toEqual([]);
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
