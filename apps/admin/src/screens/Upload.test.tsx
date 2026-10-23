import axe from 'axe-core';
import type { AlbumRow, PhotoRow } from '@mp/shared';
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeWorld, createSeqIds, fixtureSnapshot, type FakeWorld, type FakeWorldOptions } from '../adapters/fake';
import { App } from '../App';
import { AppProviders } from '../AppProviders';
import { cs } from '../i18n/cs';
import { ApiError, systemClock } from '../ports';
import { encodedPhoto, pickedFile, stubEncoder, type StubEncoder } from '../upload/testing';
import { useUploadState } from '../upload/UploadProvider';

configure({ getElementError: (message) => new Error(message ?? '') }); // no DOM dump in failures

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  Reflect.deleteProperty(navigator, 'wakeLock');
});

const SLOW = { timeout: 10_000 };

/** The real clock (the queue's 1 s grouping wait is real here), sequential ids so photo order is visible in the ids. */
async function makeWorld(over: FakeWorldOptions = {}) {
  const world = createFakeWorld({ clock: systemClock, ids: createSeqIds('aaaaaaaa'), signedIn: true, ...over });
  const category = await world.ports.catalog.createCategory({ slug: 'svatby', name: 'Svatby' });
  const album = await world.ports.catalog.createAlbum({ category_id: category.id, slug: 'novakovi', title: 'Novákovi' });
  return { world, album };
}

async function open(world: FakeWorld, album: Pick<AlbumRow, 'id' | 'title'>, encoder: StubEncoder = stubEncoder(), path?: string) {
  render(
    <AppProviders ports={world.ports} retry={false} encoder={encoder}>
      <MemoryRouter initialEntries={[path ?? `/alba/${album.id}`]}>
        <App />
      </MemoryRouter>
    </AppProviders>,
  );
  await screen.findByRole('heading', { level: 1, name: album.title });
  return encoder;
}

function pick(...files: File[]) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  fireEvent.change(input, { target: { files } });
}

const photosOf = (world: FakeWorld) => world.snapshot().photos as PhotoRow[];
const rows = () => screen.getAllByRole('list', { name: cs.upload.filesLabel })[0]!.querySelectorAll<HTMLElement>('li.upload-row');
const stepOfFirstRow = () => rows()[0]?.querySelector('.upload-step')?.textContent ?? '';
const miniBar = () => document.querySelector('.storage-mini')?.textContent ?? '';
const names = ['IMG_10.jpg', 'IMG_2.jpg', 'IMG_1.jpg', 'IMG_9.jpg', 'IMG_3.jpg'];

describe('upload happy path (F1)', () => {
  it('5 files: step labels in order, "Nahráno 5 fotek.", 5 tiles in name order, cover set once, storage bar rises', async () => {
    const { world, album } = await makeWorld();
    world.slowPut(300);
    const realCommit = world.ports.api.commit.bind(world.ports.api);
    vi.spyOn(world.ports.api, 'commit').mockImplementation(async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 250));
      return realCommit(...args);
    });
    const coverWrites = vi.spyOn(world.ports.catalog, 'updateAlbum');
    const encoder = await open(world, album);
    await screen.findByText('V albu zatím nejsou žádné fotky.');
    expect(miniBar()).toContain('0 B');

    pick(...names.map((n) => pickedFile(n)));
    await waitFor(() => expect(rows()).toHaveLength(5), SLOW);

    // The first row passes through the four labels, in this order.
    const seen: string[] = [];
    await waitFor(() => {
      const step = stepOfFirstRow();
      if (seen.at(-1) !== step) seen.push(step);
      expect(seen).toContain('Hotovo');
    }, { timeout: 15_000, interval: 20 });
    const order = ['Zpracovávám', 'Nahrávám', 'Ukládám', 'Hotovo'];
    expect(seen.filter((s) => order.includes(s))).toEqual(order);

    expect(await screen.findByText('Nahráno 5 fotek.', {}, SLOW)).toBeTruthy();
    expect(encoder.calls).toEqual(['IMG_1.jpg', 'IMG_2.jpg', 'IMG_3.jpg', 'IMG_9.jpg', 'IMG_10.jpg']);

    // The grid shows the five photos, in selection (natural name) order, which is the commit order.
    await waitFor(() => expect(document.querySelectorAll('.photo-tile')).toHaveLength(5), SLOW);
    const tileIds = [...document.querySelectorAll<HTMLElement>('.photo-tile')].map((t) => t.dataset.photoId!);
    expect(tileIds).toEqual([...tileIds].sort());
    expect(photosOf(world).map((p) => p.id)).toEqual(tileIds);

    // The storage bar rose, and the first photo became the cover exactly once.
    await waitFor(() => expect(miniBar()).toContain('14 kB'), SLOW);
    const coverCalls = coverWrites.mock.calls.filter(([, patch]) => 'cover_photo_id' in patch);
    expect(coverCalls).toHaveLength(1);
    expect((world.snapshot().albums as AlbumRow[]).find((a) => a.id === album.id)!.cover_photo_id).toBe(tileIds[0]);
    expect(screen.getByText('Nahráno 5 z 5')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Zobrazit album' })).toBeTruthy();
  }, 40_000);

  it('limits come from app_config: groups never exceed max_files_per_batch', async () => {
    const { world, album } = await makeWorld({ limits: { maxFilesPerBatch: 2 } });
    const reserve = vi.spyOn(world.ports.api, 'reserve');
    await open(world, album);
    pick(...names.map((n) => pickedFile(n)));
    await screen.findByText('Nahráno 5 fotek.', {}, SLOW);
    expect(reserve).toHaveBeenCalled();
    for (const [request] of reserve.mock.calls) expect(request.items.length).toBeLessThanOrEqual(2);
  }, 40_000);

  it('one failure: "Nahráno 4 z 5, 1 se nepodařilo.", the row says why, and Zkusit znovu finishes it', async () => {
    const { world, album } = await makeWorld();
    let broken = true;
    const encoder = stubEncoder((name) => (broken && name === 'IMG_3.jpg' ? new Error('decode') : undefined));
    await open(world, album, encoder);
    pick(...names.map((n) => pickedFile(n)));
    expect(await screen.findByText('Nahráno 4 z 5, 1 se nepodařilo.', {}, SLOW)).toBeTruthy();
    expect(screen.getByText('Fotku se nepodařilo zpracovat.')).toBeTruthy();
    expect(photosOf(world)).toHaveLength(4);

    broken = false;
    await userEvent.click(screen.getByRole('button', { name: 'Zkusit znovu neúspěšné (1)' }));
    await waitFor(() => expect(photosOf(world)).toHaveLength(5), SLOW);
    expect(await screen.findByText('Nahráno 5 z 5')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Zkusit znovu neúspěšné/ })).toBeNull();
  }, 40_000);

  it('a 422 from commit fails the row with the Czech text; the code is only under Podrobnosti; retry works', async () => {
    const { world, album } = await makeWorld();
    await open(world, album);
    world.failNext('api.commit', new ApiError('KEY_MISMATCH'));
    pick(pickedFile('IMG_1.jpg'));
    expect(await screen.findByText('Nahrávání se nepodařilo ověřit. Zkusit znovu.', {}, SLOW)).toBeTruthy();
    const details = document.querySelector('.upload-row details')!;
    expect(details.textContent).toContain('KEY_MISMATCH');
    expect(within(details as HTMLElement).getByText('Podrobnosti')).toBeTruthy();
    expect(document.querySelector('.upload-row')!.textContent!.replace(details.textContent!, '')).not.toContain('KEY_MISMATCH');

    await userEvent.click(screen.getByRole('button', { name: 'Zkusit znovu IMG_1.jpg' }));
    await waitFor(() => expect(photosOf(world)).toHaveLength(1), SLOW);
  }, 40_000);
});

describe('rejections, duplicates, storage', () => {
  it('"Nepodporovaný formát (JPEG, PNG, HEIC, WebP)." and "Soubor je příliš velký." per file, nothing queued for them', async () => {
    const { world, album } = await makeWorld({ limits: { maxUploadBytes: 5000 } });
    const encoder = await open(world, album);
    pick(pickedFile('notes.txt', 100, 'text/plain'), pickedFile('big.jpg', 6000), pickedFile('ok.jpg', 100));
    const alert = await screen.findByRole('alert', { name: cs.upload.rejectedHeading });
    expect(within(alert).getByText(/Nepodporovaný formát \(JPEG, PNG, HEIC, WebP\)\./)).toBeTruthy();
    expect(within(alert).getByText(/Soubor je příliš velký\./)).toBeTruthy();
    expect(within(alert).getByText('notes.txt')).toBeTruthy();
    await screen.findByText('Nahráno 1 fotka.', {}, SLOW);
    expect(encoder.calls).toEqual(['ok.jpg']);
  }, 40_000);

  it('the duplicate prompt defaults to skipping; "Nahrát znovu" uploads again', async () => {
    const { world, album } = await makeWorld();
    const encoder = await open(world, album);
    pick(pickedFile('a.jpg', 1000));
    await screen.findByText('Nahráno 1 fotka.', {}, SLOW);

    pick(pickedFile('a.jpg', 1000));
    const dialog = await screen.findByRole('dialog', { name: cs.upload.duplicateOne });
    const skip = within(dialog).getByRole('button', { name: 'Přeskočit' });
    expect(document.activeElement).toBe(skip);
    await userEvent.click(skip);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(encoder.calls).toEqual(['a.jpg']);
    expect(photosOf(world)).toHaveLength(1);

    pick(pickedFile('a.jpg', 1000));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Nahrát znovu' }));
    await waitFor(() => expect(photosOf(world)).toHaveLength(2), SLOW);
    expect(encoder.calls).toEqual(['a.jpg', 'a.jpg']);
  }, 40_000);

  it('level full: both drop zone controls are disabled with a role=alert, and a drop does nothing', async () => {
    const world = createFakeWorld({
      clock: systemClock,
      signedIn: true,
      seed: fixtureSnapshot(),
      limits: { quotaHardBytes: 1000, quotaWarnBytes: 900 },
    });
    const album = (world.snapshot().albums as AlbumRow[])[0]!;
    const encoder = await open(world, album);
    const zone = document.querySelector<HTMLElement>('.dropzone')!;
    const alert = await within(zone).findByRole('alert');
    expect(alert.textContent).toBe('Úložiště je plné. Nahrávání je zastaveno.');
    expect((within(zone).getByRole('button', { name: 'Vybrat fotky' }) as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector<HTMLInputElement>('input[type="file"]')!.disabled).toBe(true);
    // preventDefault on both, so a file dropped on a disabled zone does not make the browser open it
    expect(fireEvent.dragOver(zone, { dataTransfer: { files: [] } })).toBe(false);
    expect(fireEvent.drop(zone, { dataTransfer: { files: [pickedFile('x.jpg')] } })).toBe(false);
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(encoder.calls).toEqual([]);
    expect(document.querySelector('.upload-row')).toBeNull();
  });

  it('courtesy pre-check does not guess: with a little space left the file is queued and the server refuses it', async () => {
    const { world, album } = await makeWorld({ limits: { quotaHardBytes: 100, quotaWarnBytes: 50 } });
    const reserve = vi.spyOn(world.ports.api, 'reserve');
    await open(world, album);
    pick(pickedFile('IMG_1.jpg'));
    expect(await screen.findByText('Úložiště je plné. Nelze nahrát další fotky, uvolněte místo smazáním fotek.', {}, SLOW)).toBeTruthy();
    expect(reserve).toHaveBeenCalled();
    expect(photosOf(world)).toHaveLength(0);
  }, 40_000);

  it('sign-out cancels the queue and clears rows, previews and duplicate memory', async () => {
    const revoked: string[] = [];
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: (u: string) => revoked.push(u) }));
    const { world, album } = await makeWorld();
    world.slowPut(5_000);
    const encoder = stubEncoder();
    function Probe() {
      return <output data-testid="count">{useUploadState().queue.items.length}</output>;
    }
    render(
      <AppProviders ports={world.ports} retry={false} encoder={encoder}>
        <MemoryRouter initialEntries={[`/alba/${album.id}`]}>
          <App />
          <Probe />
        </MemoryRouter>
      </AppProviders>,
    );
    await screen.findByRole('heading', { level: 1, name: album.title });
    pick(pickedFile('IMG_1.jpg'), pickedFile('IMG_2.jpg'));
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('2'), SLOW);
    await userEvent.click(screen.getByRole('button', { name: 'Odhlásit se' }));
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('0'), SLOW);
    expect(revoked.length).toBe(2);
    expect(photosOf(world)).toHaveLength(0);
    vi.unstubAllGlobals();
  }, 40_000);
});

describe('queue lifetime and the browser', () => {
  it('the queue survives navigation inside the app', async () => {
    const { world, album } = await makeWorld();
    world.slowPut(400);
    await open(world, album);
    pick(...names.map((n) => pickedFile(n)));
    await waitFor(() => expect(rows()).toHaveLength(5), SLOW);

    await userEvent.click(screen.getAllByRole('link', { name: 'Nahrávání' })[0]!);
    await screen.findByRole('heading', { level: 1, name: 'Nahrávání' });
    expect(rows()).toHaveLength(5);
    await waitFor(() => expect(screen.getByText('Nahráno 5 z 5')).toBeTruthy(), { timeout: 15_000 });
    expect(photosOf(world)).toHaveLength(5);
  }, 40_000);

  it('T-246: no upload control in the header; a polite indicator shows the count only while uploading and opens the panel', async () => {
    const { world, album } = await makeWorld();
    world.slowPut(400);
    await open(world, album);
    const header = document.querySelector<HTMLElement>('.shell-header')!;
    expect(within(header).queryByText(/^Nahrávání/)).toBeNull();
    const region = document.querySelector('.upload-pill-region')!;
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.querySelector('.upload-pill')).toBeNull(); // idle: hidden

    pick(...names.map((n) => pickedFile(n)));
    await waitFor(() => expect(rows()).toHaveLength(5), SLOW);
    expect(region.querySelector('.upload-pill')).toBeNull(); // the open panel is the queue
    await userEvent.click(screen.getByRole('button', { name: cs.upload.collapse }));
    const pill = await within(region as HTMLElement).findByRole('button', { name: /Nahráno \d z 5/ });
    expect(pill.textContent).toMatch(/^Nahráno \d z 5/);
    expect(pill.parentElement).toBe(region);

    await userEvent.click(pill);
    await screen.findByRole('button', { name: cs.upload.collapse });
    expect(region.querySelector('.upload-pill')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: cs.upload.collapse }));
    await waitFor(() => expect(region.querySelector('.upload-pill')).not.toBeNull(), SLOW);

    await screen.findByText('Nahráno 5 fotek.', {}, { timeout: 15_000 });
    await waitFor(() => expect(region.querySelector('.upload-pill')).toBeNull(), SLOW); // idle again: hidden
  }, 40_000);

  it('beforeunload asks only while uploads are active, and the screen wake lock is held and released', async () => {
    const { world, album } = await makeWorld();
    world.slowPut(300);
    const release = vi.fn().mockResolvedValue(undefined);
    const request = vi.fn().mockResolvedValue({ release, released: false });
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
    await open(world, album);

    const leave = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(leave()).toBe(false);
    pick(pickedFile('IMG_1.jpg'));
    await waitFor(() => expect(rows()).toHaveLength(1), SLOW);
    expect(leave()).toBe(true);
    await waitFor(() => expect(request).toHaveBeenCalledWith('screen'));
    await screen.findByText('Nahráno 1 fotka.', {}, SLOW);
    expect(leave()).toBe(false);
    await waitFor(() => expect(release).toHaveBeenCalled());
  }, 40_000);

  it('offline and online events pause and resume the queue ("Čekám na připojení…")', async () => {
    const { world, album } = await makeWorld();
    await open(world, album);
    pick(pickedFile('IMG_1.jpg'), pickedFile('IMG_2.jpg'));
    await waitFor(() => expect(rows()).toHaveLength(2), SLOW);
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    await waitFor(() => expect(stepOfFirstRow()).toBe('Čekám na připojení…'), SLOW);
    await act(() => new Promise((resolve) => setTimeout(resolve, 1500))); // longer than the grouping wait
    expect(photosOf(world)).toHaveLength(0);
    expect(stepOfFirstRow()).toBe('Čekám na připojení…');

    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await screen.findByText('Nahráno 2 fotky.', {}, SLOW);
    expect(photosOf(world)).toHaveLength(2);
  }, 40_000);

  it('shows the local preview of an uploaded photo until the public image has loaded', async () => {
    const created: string[] = [];
    const revoked: string[] = [];
    vi.stubGlobal('URL', Object.assign(URL, {
      createObjectURL: () => {
        const url = `blob:test-${created.length}`;
        created.push(url);
        return url;
      },
      revokeObjectURL: (url: string) => revoked.push(url),
    }));
    const { world, album } = await makeWorld();
    await open(world, album);
    pick(pickedFile('IMG_1.jpg'));
    await screen.findByText('Nahráno 1 fotka.', {}, SLOW);
    const tile = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('.photo-tile');
      expect(found).toBeTruthy();
      return found!;
    }, SLOW);
    const local = tile.querySelector<HTMLImageElement>('img.photo-local')!;
    expect(local.getAttribute('src')).toBe(created[0]);
    fireEvent.load(tile.querySelector<HTMLImageElement>('img.photo-img:not(.photo-local)')!);
    await waitFor(() => expect(tile.querySelector('img.photo-local')).toBeNull());
    expect(revoked).toContain(created[0]);
    vi.unstubAllGlobals();
  }, 40_000);
});

describe('T-268 phases, small-photo warning, refusal rows', () => {
  it('shows "Připravuji náhledy" then "Nahrávám detail", then the small-photo warning with the size, and the photo still uploads', async () => {
    const { world, album } = await makeWorld();
    let toDetail!: () => void;
    let toEnd!: () => void;
    const encoder: StubEncoder = {
      calls: [],
      async encode(file, _signal, onPhase) {
        onPhase?.('previews');
        await new Promise<void>((r) => (toDetail = r));
        onPhase?.('detail');
        await new Promise<void>((r) => (toEnd = r));
        return encodedPhoto(1600, 1200);
      },
    };
    await open(world, album, encoder);
    pick(pickedFile('IMG_1.jpg'));
    await waitFor(() => expect(stepOfFirstRow()).toBe('Připravuji náhledy'), SLOW);
    expect(rows()[0]!.querySelector('.upload-warning')).toBeNull();
    expect(rows()[0]!.querySelector('.upload-step')!.getAttribute('aria-live')).toBe('polite');
    toDetail();
    await waitFor(() => expect(stepOfFirstRow()).toBe('Nahrávám detail'), SLOW);
    toEnd();
    const warning = await waitFor(() => {
      const w = rows()[0]!.querySelector('.upload-warning');
      expect(w).not.toBeNull();
      return w!;
    }, SLOW);
    expect(warning.textContent).toBe('Pozor: Původní fotka je malá, bude jen do 1600 px');
    expect(warning.getAttribute('aria-live')).toBe('polite');
    expect(await screen.findByText('Nahráno 1 fotka.', {}, SLOW)).toBeTruthy();
    expect(rows()[0]!.querySelector('.upload-warning')).not.toBeNull(); // stays visible on the finished row
    expect(photosOf(world)).toHaveLength(1);
  }, 40_000);

  it('a too-big file gets a refusal row: text, no retry, no bulk retry, only "Odebrat z fronty"; the rest uploads', async () => {
    const { world, album } = await makeWorld();
    const refuse = Object.assign(new Error('TOO_MANY_PIXELS'), { code: 'TOO_MANY_PIXELS', userMessage: cs.encode.tooManyPixels });
    await open(world, album, stubEncoder((name) => (name === 'IMG_2.jpg' ? refuse : undefined)));
    pick(pickedFile('IMG_1.jpg'), pickedFile('IMG_2.jpg'));
    await screen.findByText('Nahráno 1 z 2, 1 se nepodařilo.', {}, SLOW);
    const row = rows()[1]!;
    expect(row.dataset.refused).toBe('true');
    expect(row.querySelector('.upload-step')!.textContent).toBe(`Nelze nahrát: ${cs.encode.tooManyPixels}`);
    expect(screen.queryByRole('button', { name: 'Zkusit znovu IMG_2.jpg' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Zkusit znovu neúspěšné/ })).toBeNull();
    expect(row.querySelector('progress')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Odebrat z fronty IMG_2.jpg' }));
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(photosOf(world)).toHaveLength(1);
  }, 40_000);
});

describe('accessibility', () => {
  it('has no serious axe violations with rows, a failure, the rejected list and on /nahravani', async () => {
    const { world, album } = await makeWorld();
    const encoder = stubEncoder((name) => (name === 'IMG_2.jpg' ? new Error('decode') : undefined));
    await open(world, album, encoder);
    pick(pickedFile('IMG_1.jpg'), pickedFile('IMG_2.jpg'), pickedFile('x.txt', 10, 'text/plain'));
    await screen.findByText('Nahráno 1 z 2, 1 se nepodařilo.', {}, SLOW);
    const run = () =>
      axe.run(document.body, {
        runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
        rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
      });
    const bad = (r: Awaited<ReturnType<typeof run>>) =>
      r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes[0]?.html}`);
    expect(bad(await run())).toEqual([]);
    await userEvent.click(screen.getAllByRole('link', { name: 'Nahrávání' })[0]!);
    await screen.findByRole('heading', { level: 1, name: 'Nahrávání' });
    expect(bad(await run())).toEqual([]);
  }, 40_000);
});
