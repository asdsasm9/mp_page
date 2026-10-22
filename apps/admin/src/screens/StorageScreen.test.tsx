import axe from 'axe-core';
import { allKeys, planUploadFiles, type PhotoRow } from '@mp/shared';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync, readdirSync } from 'node:fs';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeWorld, fixtureSnapshot, type FakeWorld, type FakeWorldOptions } from '../adapters/fake';
import { App } from '../App';
import { AppProviders } from '../AppProviders';
import { cs } from '../i18n/cs';
import { formatBytes } from '../i18n/format';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const t = cs.storageScreen;
const HOUR = 3_600_000;

function makeWorld(options: FakeWorldOptions = {}) {
  return createFakeWorld({ signedIn: true, seed: fixtureSnapshot(), ...options });
}

async function open(world: FakeWorld) {
  const view = render(
    <AppProviders ports={world.ports} retry={false}>
      <MemoryRouter initialEntries={['/ulozeni']}>
        <App />
      </MemoryRouter>
    </AppProviders>,
  );
  await screen.findByRole('heading', { level: 1, name: cs.routes.storage.title });
  await screen.findByRole('table');
  return view;
}

const checkButton = () => screen.getByRole('button', { name: cs.glossary.checkStorage });
const applyCalls = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.filter((c) => (c[0] as { apply?: boolean }).apply === true);

async function axeClean(container: Element) {
  const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
  expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(' | ')}`)).toEqual([]);
}

describe('storage screen: breakdown', () => {
  it('lists albums biggest first and the rows add up to the storage total', async () => {
    const world = makeWorld();
    await open(world);
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1, -1);
    expect(rows.length).toBeGreaterThan(1);

    const snapshot = world.snapshot();
    const bytesOf = new Map<string, number>();
    for (const p of snapshot.photos as PhotoRow[]) bytesOf.set(p.album_id, (bytesOf.get(p.album_id) ?? 0) + p.bytes_total);
    const expected = [...bytesOf.values()].sort((a, b) => b - a).map(formatBytes);
    expect(rows.map((r) => within(r).getAllByRole('cell').at(-1)!.textContent)).toEqual(expected);

    const used = (await world.ports.api.getStorage()).used_bytes;
    const total = [...bytesOf.values()].reduce((n, b) => n + b, 0);
    expect(total).toBe(used);
    const footer = screen.getByRole('table').querySelector('tfoot')!;
    expect(footer.textContent).toContain(formatBytes(used));
  });

  it('keeps reserved bytes out of the sum and names them separately', async () => {
    const world = makeWorld();
    const snapshot = world.snapshot();
    const album = (snapshot.albums as { id: string }[])[0]!;
    const pid = 'dddddddd-0000-4000-8000-000000000001';
    await world.ports.api.reserve({
      album_id: album.id,
      items: [
        {
          photo_id: pid,
          width: 1200,
          height: 800,
          files: planUploadFiles(pid, 1200, 800).map((f) => ({ kind: f.kind, ...(f.tier ? { tier: f.tier } : {}), bytes: 1000 })),
        },
      ],
    });
    await open(world);
    const storage = await world.ports.api.getStorage();
    expect(storage.reserved_bytes).toBe(6000);
    expect(screen.getByText(`Rozpracovaná nahrávání mají rezervováno ${formatBytes(6000)}. Do součtu se započítají, až se dokončí.`)).toBeTruthy();
    expect(screen.getByRole('table').querySelector('tfoot')!.textContent).toContain(formatBytes(storage.used_bytes));
  });

  it('shows the large storage bar', async () => {
    await open(makeWorld());
    expect(screen.getByRole('region', { name: cs.glossary.storage })).toBeTruthy();
  });
});

describe('storage screen: check', () => {
  it('follows the cursor over two pages, says "Součet souhlasí." and never sends apply: true', async () => {
    const world = makeWorld({ reconcilePageObjects: 10 });
    const spy = vi.spyOn(world.ports.api, 'reconcile');
    await open(world);
    await userEvent.setup().click(checkButton());
    expect(await screen.findByText('Součet souhlasí.')).toBeTruthy();
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(spy.mock.calls[0]![0]).toEqual({});
    expect((spy.mock.calls[1]![0] as { cursor?: string }).cursor).toBeTruthy();
    expect(applyCalls(spy)).toHaveLength(0);
    // The pages added up to one run.
    const storage = await world.ports.api.getStorage();
    expect(screen.getByText(new RegExp(`Zkontrolováno: .*${formatBytes(storage.used_bytes)}`))).toBeTruthy();
    expect(screen.queryByRole('button', { name: t.cleanup })).toBeNull();
  });

  it('reports orphans, missing objects, size mismatches and unknown keys in plain Czech; missing and mismatch rows have no action', async () => {
    const world = makeWorld();
    const snapshot = world.snapshot();
    const photos = snapshot.photos as PhotoRow[];
    const [a, b] = [photos[0]!, photos[1]!];
    const keysA = allKeys(a.id, a.variants);
    const keysB = allKeys(b.id, b.variants);
    world.putObject(`photos/eeeeeeee-0000-4000-8000-000000000001/master.jpg`, 500, 3 * HOUR);
    world.putObject(`photos/eeeeeeee-0000-4000-8000-000000000002/master.jpg`, 1500, 3 * HOUR);
    world.removeObject(keysA[1]!);
    world.putObject(keysB[0]!, 7);
    world.putObject('photos/not-a-photo/readme.txt', 10);

    const spy = vi.spyOn(world.ports.api, 'reconcile');
    await open(world);
    await userEvent.setup().click(checkButton());
    await screen.findByText(t.findingsTitle);

    expect(screen.queryByText('Součet souhlasí.')).toBeNull();
    const orphans = screen.getByRole('heading', { name: t.orphansTitle }).closest('section')!;
    expect(orphans.textContent).toContain('2 soubory, 2 kB');
    expect(orphans.textContent).toContain('Můžete je bezpečně smazat');

    const missing = screen.getByRole('heading', { name: t.missingTitle }).closest('section')!;
    expect(missing.textContent).toContain('Automaticky se to opravit nedá');
    expect(within(missing).getAllByRole('listitem')[0]!.textContent).toMatch(/^Fotka \d+ v albu .+: chybí 1 soubor$/);
    expect(within(missing).queryByRole('button')).toBeNull();

    const mismatch = screen.getByRole('heading', { name: t.mismatchTitle }).closest('section')!;
    expect(within(mismatch).getAllByRole('listitem')[0]!.textContent).toContain(`zapsáno ${formatBytes(b.variants.master.bytes)}, v úložišti 7 B`);
    expect(within(mismatch).queryByRole('button')).toBeNull();

    const unknown = screen.getByRole('heading', { name: t.unknownTitle }).closest('section')!;
    expect(unknown.textContent).toContain('1 soubor');
    expect(within(unknown).queryByRole('button')).toBeNull();

    expect(screen.getAllByRole('button', { name: t.cleanup })).toHaveLength(1);
    expect(applyCalls(spy)).toHaveLength(0);
  });

  it('cleanup needs a confirmation, Cancel returns focus to the opener, confirming sends apply: true and re-checks', async () => {
    const world = makeWorld();
    world.putObject(`photos/eeeeeeee-0000-4000-8000-000000000001/master.jpg`, 500, 3 * HOUR);
    const spy = vi.spyOn(world.ports.api, 'reconcile');
    await open(world);
    const user = userEvent.setup();
    await user.click(checkButton());
    const opener = await screen.findByRole('button', { name: t.cleanup });
    await user.click(opener);

    const dialog = await screen.findByRole('dialog', { name: t.cleanupTitle });
    expect(dialog.textContent).toContain('Smaže se 1 soubor (500 B)');
    expect(applyCalls(spy)).toHaveLength(0);

    await user.click(within(dialog).getByRole('button', { name: cs.glossary.cancel }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(opener);
    expect(applyCalls(spy)).toHaveLength(0);
    expect(world.snapshot().objects.some((o) => o.key.includes('eeeeeeee'))).toBe(true);

    await user.click(opener);
    const again = await screen.findByRole('dialog', { name: t.cleanupTitle });
    await user.click(within(again).getByRole('button', { name: cs.glossary.delete }));
    expect(await screen.findByText('Smazán 1 soubor. Uvolněno 500 B.')).toBeTruthy();
    expect(applyCalls(spy)).toHaveLength(1);
    expect(world.snapshot().objects.some((o) => o.key.includes('eeeeeeee'))).toBe(false);
    expect(await screen.findByText('Součet souhlasí.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: t.cleanup })).toBeNull();
  });

  it('a failed check says so and offers a retry', async () => {
    const world = makeWorld();
    world.failNext('api.reconcile', 'network');
    await open(world);
    const user = userEvent.setup();
    await user.click(checkButton());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(t.checkFailed);
    await user.click(within(alert).getByRole('button', { name: cs.glossary.retry }));
    expect(await screen.findByText('Součet souhlasí.')).toBeTruthy();
  });

  it('keeps focus on the check button while it runs', async () => {
    const world = makeWorld({ reconcilePageObjects: 10 });
    await open(world);
    const user = userEvent.setup();
    await user.click(checkButton());
    expect(document.activeElement).toBe(checkButton());
    await screen.findByText('Součet souhlasí.');
    expect(document.activeElement).toBe(checkButton());
  });

  it('has no accessibility violations: idle, with findings and with the confirmation open', async () => {
    const world = makeWorld();
    world.putObject(`photos/eeeeeeee-0000-4000-8000-000000000001/master.jpg`, 500, 3 * HOUR);
    world.putObject('photos/not-a-photo/readme.txt', 10);
    const view = await open(world);
    await axeClean(view.container);
    const user = userEvent.setup();
    await user.click(checkButton());
    await user.click(await screen.findByRole('button', { name: t.cleanup }));
    await screen.findByRole('dialog');
    await axeClean(document.body);
  });
});

describe('no "use the real value" action', () => {
  it('appears nowhere in the admin source', () => {
    const needle = ['Použít skutečnou', 'hodnotu'].join(' ');
    const srcDir = `${import.meta.dirname}/..`;
    const files = (readdirSync(srcDir, { recursive: true }) as string[]).filter((f) => /\.(ts|tsx|css|html)$/.test(f));
    expect(files.length).toBeGreaterThan(20);
    for (const file of files) expect(readFileSync(`${srcDir}/${file}`, 'utf8'), file).not.toContain(needle);
  });
});
