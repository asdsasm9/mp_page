/** Replace a photo with a better file (T-262, WP-10 step 8, D-21 option A) against the fake world. */
import axe from 'axe-core';
import { sumBytes, type AlbumRow, type CategoryRow, type PhotoRow } from '@mp/shared';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeWorld, createSeqIds, type FakeWorld } from '../adapters/fake';
import { App } from '../App';
import { AppProviders } from '../AppProviders';
import { takeCategoryCoverCleared } from '../data/categoryCoverNotice';
import { cs } from '../i18n/cs';
import { formatBytes } from '../i18n/format';
import { ApiError, systemClock } from '../ports';
import { encodedPhoto, pickedFile, stubEncoder } from '../upload/testing';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const t = cs.photos.replace;
const SLOW = { timeout: 10_000 };

const photosOf = (world: FakeWorld) => world.snapshot().photos as PhotoRow[];
const albumOf = (world: FakeWorld, id: string) => (world.snapshot().albums as AlbumRow[]).find((a) => a.id === id)!;

/** One photo through the real reserve / PUT / commit ports (the stub encoder's shape). */
async function addPhoto(world: FakeWorld, albumId: string): Promise<PhotoRow> {
  const enc = encodedPhoto();
  const id = world.ports.ids.uuid();
  const reserved = await world.ports.api.reserve({
    album_id: albumId,
    items: [
      {
        photo_id: id,
        width: enc.width,
        height: enc.height,
        files: enc.files.map((f) => (f.tier === undefined ? { kind: f.kind, bytes: f.bytes } : { kind: f.kind, tier: f.tier, bytes: f.bytes })),
      },
    ],
  });
  for (const target of reserved.items[0]!.uploads!) {
    const file = enc.files.find((f) => f.kind === target.kind && f.tier === target.tier)!;
    await world.ports.upload.put(target, file.body);
  }
  const response = await world.ports.api.commit({
    photo_id: id,
    album_id: albumId,
    width: enc.width,
    height: enc.height,
    dominant_color: enc.dominantColor!,
    variants: enc.variants,
    bytes_total: sumBytes(enc.variants),
  });
  return response.photo;
}

/** An album with three photos; the middle one has texts and (by default) is the cover. */
async function setup(options: { middleIsCover?: boolean } = {}) {
  const world = createFakeWorld({ clock: systemClock, ids: createSeqIds('bbbbbbbb'), signedIn: true });
  const category = await world.ports.catalog.createCategory({ slug: 'svatby', name: 'Svatby' });
  const album = await world.ports.catalog.createAlbum({ category_id: category.id, slug: 'novakovi', title: 'Novákovi' });
  const first = await addPhoto(world, album.id);
  const middle = await addPhoto(world, album.id);
  const last = await addPhoto(world, album.id);
  await world.ports.catalog.updatePhoto(middle.id, { alt: 'Nevěsta s kyticí', caption: 'První tanec' });
  await world.ports.catalog.updateAlbum(album.id, { cover_photo_id: options.middleIsCover === false ? first.id : middle.id });
  return { world, album, first, middle: photosOf(world).find((p) => p.id === middle.id)!, last };
}

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

async function open(world: FakeWorld, album: Pick<AlbumRow, 'id'>, photo: Pick<PhotoRow, 'id'>, n = 2) {
  const encoder = stubEncoder();
  render(
    <AppProviders ports={world.ports} retry={false} encoder={encoder}>
      <MemoryRouter initialEntries={[`/alba/${album.id}/foto/${photo.id}`]}>
        <App />
        <Where />
      </MemoryRouter>
    </AppProviders>,
  );
  await screen.findByRole('heading', { level: 1, name: `Fotka ${n} z 3` });
  return encoder;
}

function pick(file: File) {
  fireEvent.change(document.querySelector<HTMLInputElement>('input[type="file"]')!, { target: { files: [file] } });
}

/** Picks a file and confirms in the dialog. */
async function pickAndConfirm(user: ReturnType<typeof userEvent.setup>, file = pickedFile('lepsi.jpg', 5_000_000)) {
  pick(file);
  const dialog = await screen.findByRole('dialog', { name: t.title });
  await user.click(within(dialog).getByRole('button', { name: t.confirm }));
}

/** A JPEG whose header says `w` x `h` (nothing else is valid). */
function jpegHeader(w: number, h: number): File {
  const bytes = new Uint8Array(64);
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03]);
  return new File([bytes], 'obri.jpg', { type: 'image/jpeg' });
}

const spies = (world: FakeWorld) => ({
  reserve: vi.spyOn(world.ports.api, 'reserve'),
  commit: vi.spyOn(world.ports.api, 'commit'),
  del: vi.spyOn(world.ports.api, 'deletePhotos'),
  updatePhoto: vi.spyOn(world.ports.catalog, 'updatePhoto'),
  updateAlbum: vi.spyOn(world.ports.catalog, 'updateAlbum'),
});

describe('replace a photo with a better version', () => {
  it('happy path: new id in the same album, texts and sort copied, cover moved, old deleted, quota is the new bytes', async () => {
    const user = userEvent.setup();
    const { world, album, middle } = await setup();
    const { reserve, del } = spies(world);
    await open(world, album, middle);

    await user.click(screen.getByRole('button', { name: t.button }));
    pick(pickedFile('lepsi.jpg', 5_000_000));

    // The confirmation shows before and after (resolution and size) and nothing was sent yet.
    const dialog = await screen.findByRole('dialog', { name: t.title });
    expect(within(dialog).getByText('3000 × 2000 px')).toBeTruthy();
    expect(within(dialog).getByText('lepsi.jpg')).toBeTruthy();
    expect(within(dialog).getByText(formatBytes(5_000_000))).toBeTruthy();
    expect(within(dialog).getByText(formatBytes(middle.variants.master.bytes))).toBeTruthy();
    expect(within(dialog).getByText(t.unknown)).toBeTruthy(); // the picked stub is no real JPEG: no header size
    expect(reserve).not.toHaveBeenCalled();
    expect(photosOf(world)).toHaveLength(3);

    await user.click(within(dialog).getByRole('button', { name: t.confirm }));
    await waitFor(() => expect(del).toHaveBeenCalledTimes(1), SLOW);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), SLOW);

    const after = photosOf(world);
    expect(after).toHaveLength(3);
    expect(after.some((p) => p.id === middle.id)).toBe(false);
    const added = after.find((p) => p.alt === 'Nevěsta s kyticí')!;
    expect(added.id).not.toBe(middle.id);
    expect(added.album_id).toBe(album.id);
    expect(added.sort).toBe(middle.sort);
    expect(added.caption).toBe('První tanec');
    expect(albumOf(world, album.id).cover_photo_id).toBe(added.id);
    // A new id was reserved: the old id is never reused.
    expect(reserve.mock.calls.every(([request]) => request.items.every((i) => i.photo_id !== middle.id))).toBe(true);
    expect(del.mock.calls[0]![0]).toEqual({ ids: [middle.id] });
    // Old objects are gone and the quota is exactly the three photos' bytes.
    expect(world.snapshot().objects.some((o) => o.key.includes(middle.id))).toBe(false);
    const storage = await world.ports.api.getStorage();
    expect(storage.used_bytes).toBe(after.reduce((sum, p) => sum + p.bytes_total, 0));
    expect(added.bytes_total).toBe(sumBytes(encodedPhoto().variants));
    // The detail now shows the new photo.
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe(`/alba/${album.id}/foto/${added.id}`));
    expect(await screen.findByText(t.done)).toBeTruthy();
  }, 30_000);

  it('quota used equals the new photo bytes when the replaced photo was the only one', async () => {
    const user = userEvent.setup();
    const world = createFakeWorld({ clock: systemClock, ids: createSeqIds('cccccccc'), signedIn: true });
    const category = await world.ports.catalog.createCategory({ slug: 'portrety', name: 'Portréty' });
    const album = await world.ports.catalog.createAlbum({ category_id: category.id, slug: 'jedna', title: 'Jedna' });
    const only = await addPhoto(world, album.id);
    await world.ports.catalog.updateAlbum(album.id, { cover_photo_id: only.id });
    const encoder = stubEncoder();
    render(
      <AppProviders ports={world.ports} retry={false} encoder={encoder}>
        <MemoryRouter initialEntries={[`/alba/${album.id}/foto/${only.id}`]}>
          <App />
        </MemoryRouter>
      </AppProviders>,
    );
    await screen.findByRole('heading', { level: 1, name: 'Fotka 1 z 1' });
    await pickAndConfirm(user);
    await waitFor(() => expect(photosOf(world).some((p) => p.id === only.id)).toBe(false), SLOW);
    const [added] = photosOf(world);
    expect(photosOf(world)).toHaveLength(1);
    expect((await world.ports.api.getStorage()).used_bytes).toBe(added!.bytes_total);
    expect(albumOf(world, album.id).cover_photo_id).toBe(added!.id);
  }, 30_000);

  it('a photo that is not the cover leaves the cover alone', async () => {
    const user = userEvent.setup();
    const { world, album, first, middle } = await setup({ middleIsCover: false });
    const { updateAlbum } = spies(world);
    await open(world, album, middle);
    await pickAndConfirm(user);
    await waitFor(() => expect(photosOf(world).some((p) => p.id === middle.id)).toBe(false), SLOW);
    expect(updateAlbum.mock.calls.filter(([, patch]) => 'cover_photo_id' in patch)).toHaveLength(0);
    expect(albumOf(world, album.id).cover_photo_id).toBe(first.id);
  }, 30_000);

  it('the main photo of the category moves to the new photo before the old one is deleted (no cleared choice)', async () => {
    const user = userEvent.setup();
    const { world, album, middle } = await setup();
    await world.ports.catalog.updateCategory(album.category_id, { cover_photo_id: middle.id });
    const categoryOf = () => (world.snapshot().categories as CategoryRow[]).find((c) => c.id === album.category_id)!;
    const updateCategory = vi.spyOn(world.ports.catalog, 'updateCategory');
    await open(world, album, middle);
    await pickAndConfirm(user);
    await waitFor(() => expect(photosOf(world).some((p) => p.id === middle.id)).toBe(false), SLOW);
    const added = photosOf(world).find((p) => p.alt === 'Nevěsta s kyticí')!;
    expect(categoryOf().cover_photo_id).toBe(added.id);
    expect(updateCategory).toHaveBeenCalledTimes(1);
    expect(takeCategoryCoverCleared(album.category_id)).toBe(false);
  }, 30_000);

  it('a photo that is not the main photo of the category leaves it alone', async () => {
    const user = userEvent.setup();
    const { world, album, first, middle } = await setup();
    await world.ports.catalog.updateCategory(album.category_id, { cover_photo_id: first.id });
    const updateCategory = vi.spyOn(world.ports.catalog, 'updateCategory');
    await open(world, album, middle);
    await pickAndConfirm(user);
    await waitFor(() => expect(photosOf(world).some((p) => p.id === middle.id)).toBe(false), SLOW);
    expect(updateCategory).not.toHaveBeenCalled();
    expect((world.snapshot().categories as CategoryRow[]).find((c) => c.id === album.category_id)!.cover_photo_id).toBe(first.id);
  }, 30_000);

  it('a rejected file changes nothing: wrong type, over the pixel limit', async () => {
    const user = userEvent.setup();
    const { world, album, middle } = await setup();
    const s = spies(world);
    const before = world.snapshot();
    await open(world, album, middle);

    await user.click(screen.getByRole('button', { name: t.button }));
    pick(new File(['x'], 'poznamky.txt', { type: 'text/plain' }));
    expect((await screen.findByRole('alert')).textContent).toContain(cs.upload.unsupported);
    pick(jpegHeader(9000, 9000));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(cs.encode.tooManyPixels));
    expect(screen.queryByRole('dialog')).toBeNull();

    expect(s.reserve).not.toHaveBeenCalled();
    expect(s.commit).not.toHaveBeenCalled();
    expect(s.del).not.toHaveBeenCalled();
    expect(s.updatePhoto).not.toHaveBeenCalled();
    expect(s.updateAlbum).not.toHaveBeenCalled();
    expect(world.snapshot().photos).toEqual(before.photos);
    expect(world.snapshot().albums).toEqual(before.albums);
    expect(world.snapshot().objects).toEqual(before.objects);
  });

  it('cancelling the confirmation, also with Escape, changes nothing', async () => {
    const user = userEvent.setup();
    const { world, album, middle } = await setup();
    const s = spies(world);
    await open(world, album, middle);
    pick(pickedFile('lepsi.jpg'));
    const dialog = await screen.findByRole('dialog', { name: t.title });
    await user.click(within(dialog).getByRole('button', { name: 'Zrušit' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    pick(pickedFile('lepsi.jpg'));
    await screen.findByRole('dialog', { name: t.title });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(s.reserve).not.toHaveBeenCalled();
    expect(s.del).not.toHaveBeenCalled();
    expect(photosOf(world)).toHaveLength(3);
  });

  it('an upload that fails changes nothing and can be retried', async () => {
    const user = userEvent.setup();
    const { world, album, middle } = await setup();
    const s = spies(world);
    await open(world, album, middle);
    world.failNext('api.reserve', new ApiError('INVALID_ITEMS'));
    await pickAndConfirm(user);
    const dialog = await screen.findByRole('dialog', { name: t.uploadFailedTitle }, SLOW);
    expect(within(dialog).getByText(t.uploadFailedBody)).toBeTruthy();
    expect(photosOf(world)).toHaveLength(3);
    expect(photosOf(world).some((p) => p.id === middle.id)).toBe(true);
    expect(s.del).not.toHaveBeenCalled();
    expect(s.updatePhoto).not.toHaveBeenCalled();
    // Zkusit znovu runs the whole thing again.
    await user.click(within(dialog).getByRole('button', { name: 'Zkusit znovu' }));
    await waitFor(() => expect(photosOf(world).some((p) => p.id === middle.id)).toBe(false), SLOW);
    expect(photosOf(world)).toHaveLength(3);
  }, 30_000);

  it('a failed copy leaves both photos, never deletes the old one, and Dokončit finishes the swap', async () => {
    const user = userEvent.setup();
    const { world, album, middle } = await setup();
    const s = spies(world);
    await open(world, album, middle);
    world.failNext('catalog.updatePhoto', new ApiError('INTERNAL'));
    await pickAndConfirm(user);

    const dialog = await screen.findByRole('dialog', { name: t.incompleteTitle }, SLOW);
    expect(within(dialog).getByRole('button', { name: t.finish })).toBeTruthy();
    expect(photosOf(world)).toHaveLength(4); // the old and the new photo
    expect(photosOf(world).some((p) => p.id === middle.id)).toBe(true);
    expect(s.del).not.toHaveBeenCalled();
    expect(albumOf(world, album.id).cover_photo_id).toBe(middle.id);

    await user.click(within(dialog).getByRole('button', { name: t.finish }));
    await waitFor(() => expect(photosOf(world).some((p) => p.id === middle.id)).toBe(false), SLOW);
    const added = photosOf(world).find((p) => p.alt === 'Nevěsta s kyticí')!;
    expect(added.sort).toBe(middle.sort);
    expect(added.caption).toBe('První tanec');
    expect(albumOf(world, album.id).cover_photo_id).toBe(added.id);
    expect(s.del).toHaveBeenCalledTimes(1);
  }, 30_000);

  it('a failed cover step keeps the old photo and the old cover; Dokončit repeats from there', async () => {
    const user = userEvent.setup();
    const { world, album, middle } = await setup();
    const s = spies(world);
    await open(world, album, middle);
    world.failNext('catalog.updateAlbum', new ApiError('INTERNAL'));
    await pickAndConfirm(user);
    const dialog = await screen.findByRole('dialog', { name: t.incompleteTitle }, SLOW);
    expect(s.del).not.toHaveBeenCalled();
    expect(albumOf(world, album.id).cover_photo_id).toBe(middle.id);
    expect(photosOf(world)).toHaveLength(4);
    await user.click(within(dialog).getByRole('button', { name: t.finish }));
    await waitFor(() => expect(photosOf(world).some((p) => p.id === middle.id)).toBe(false), SLOW);
    const cover = albumOf(world, album.id).cover_photo_id;
    expect(photosOf(world).some((p) => p.id === cover)).toBe(true);
  }, 30_000);

  it('a failed delete leaves both photos with the cover already on the new one; Zrušit keeps both', async () => {
    const user = userEvent.setup();
    const { world, album, middle } = await setup();
    await open(world, album, middle);
    world.failNext('api.deletePhotos', new ApiError('INTERNAL'));
    await pickAndConfirm(user);
    const dialog = await screen.findByRole('dialog', { name: t.incompleteTitle }, SLOW);
    expect(photosOf(world)).toHaveLength(4);
    const added = photosOf(world).find((p) => p.id !== middle.id && p.alt === 'Nevěsta s kyticí')!;
    expect(albumOf(world, album.id).cover_photo_id).toBe(added.id);

    await user.click(within(dialog).getByRole('button', { name: 'Zrušit' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText(t.keptBoth)).toBeTruthy();
    expect(photosOf(world)).toHaveLength(4);
    expect(photosOf(world).some((p) => p.id === middle.id)).toBe(true);
  }, 30_000);

  it('refuses to delete when the two photos are not in the same album', async () => {
    const user = userEvent.setup();
    const { world, album, middle } = await setup();
    const realUpdate = world.ports.catalog.updatePhoto.bind(world.ports.catalog);
    const s = spies(world);
    const other = await world.ports.catalog.createAlbum({ category_id: albumOf(world, album.id).category_id, slug: 'jine', title: 'Jiné' });
    await open(world, album, middle);
    // Between the add and the delete the new photo is moved away (another device).
    s.updatePhoto.mockImplementation(async (id, patch, options) => {
      const row = await realUpdate(id, patch, options);
      await realUpdate(id, { album_id: other.id });
      return row;
    });
    await pickAndConfirm(user);
    await screen.findByRole('dialog', { name: t.incompleteTitle }, SLOW);
    expect(s.del).not.toHaveBeenCalled();
    expect(photosOf(world).some((p) => p.id === middle.id)).toBe(true);
  }, 30_000);

  it('the dialog has no serious axe violations and returns focus to the button', async () => {
    const user = userEvent.setup();
    const { world, album, middle } = await setup();
    await open(world, album, middle);
    const button = screen.getByRole('button', { name: t.button });
    await user.click(button);
    pick(pickedFile('lepsi.jpg'));
    await screen.findByRole('dialog', { name: t.title });
    expect(document.activeElement?.textContent).toBe(t.confirm);
    const result = await axe.run(document.body, {
      runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
      rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
    });
    expect(result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(button);
  });
});
