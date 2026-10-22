import type { AlbumRow, PhotoRow } from '@mp/shared';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { createFakeWorld, fixtureSnapshot } from '../adapters/fake';
import { AppProviders } from '../AppProviders';
import { usePhotoActions } from './photoActions';

type Actions = ReturnType<typeof usePhotoActions>;

async function withActions(world: ReturnType<typeof createFakeWorld>): Promise<Actions> {
  let actions: Actions | null = null;
  function Probe() {
    actions = usePhotoActions();
    return null;
  }
  render(
    <AppProviders ports={world.ports} retry={false}>
      <MemoryRouter>
        <Probe />
      </MemoryRouter>
    </AppProviders>,
  );
  await waitFor(() => expect(actions).not.toBeNull());
  return {
    setCover: (...a) => actions!.setCover(...a),
    ensureCover: (...a) => actions!.ensureCover(...a),
    reorder: (...a) => actions!.reorder(...a),
    movePhotos: (...a) => actions!.movePhotos(...a),
  };
}

describe('ensureCover (auto-cover after the first upload)', () => {
  it('gives an album without a cover its first photo and leaves a chosen cover alone', async () => {
    const world = createFakeWorld({ signedIn: true, seed: fixtureSnapshot() });
    const photos = world.snapshot().photos as PhotoRow[];
    const album = (world.snapshot().albums as AlbumRow[]).find((a) => photos.filter((p) => p.album_id === a.id).length >= 2)!;
    const rows = photos.filter((p) => p.album_id === album.id);
    await world.ports.catalog.updateAlbum(album.id, { cover_photo_id: null });
    const actions = await withActions(world);

    expect(await actions.ensureCover(album.id)).toBe(rows[0]!.id);
    const after = (world.snapshot().albums as AlbumRow[]).find((a) => a.id === album.id)!;
    expect(after.cover_photo_id).toBe(rows[0]!.id);

    await world.ports.catalog.updateAlbum(album.id, { cover_photo_id: rows[1]!.id });
    expect(await actions.ensureCover(album.id)).toBeNull();
    expect((world.snapshot().albums as AlbumRow[]).find((a) => a.id === album.id)!.cover_photo_id).toBe(rows[1]!.id);
  });
});

describe('movePhotos and the target cover', () => {
  function pair() {
    const world = createFakeWorld({ signedIn: true, seed: fixtureSnapshot() });
    const photos = world.snapshot().photos as PhotoRow[];
    const albums = world.snapshot().albums as AlbumRow[];
    const count = (a: AlbumRow) => photos.filter((p) => p.album_id === a.id).length;
    const source = albums.find((a) => count(a) >= 3)!;
    const target = albums.find((a) => a.id !== source.id && count(a) >= 1)!;
    const coverOf = (id: string) => (world.snapshot().albums as AlbumRow[]).find((a) => a.id === id)!.cover_photo_id;
    return { world, source, target, rows: photos.filter((p) => p.album_id === source.id), coverOf };
  }

  it('gives a cover-less target album its first photo as cover', async () => {
    const { world, source, target, rows, coverOf } = pair();
    await world.ports.catalog.updateAlbum(target.id, { cover_photo_id: null });
    const actions = await withActions(world);
    await actions.movePhotos(source, target.id, [rows[1]!.id]);
    expect(coverOf(target.id)).not.toBeNull();
    const targetPhotos = (world.snapshot().photos as PhotoRow[]).filter((p) => p.album_id === target.id);
    expect(coverOf(target.id)).toBe(targetPhotos[0]!.id);
  });

  it('moving into an empty album makes the first moved photo its cover', async () => {
    const { world, source, rows, coverOf } = pair();
    const category = (world.snapshot().categories as { id: string }[])[0]!;
    const empty = await world.ports.catalog.createAlbum({ category_id: category.id, slug: 'prazdne', title: 'Prázdné' });
    const actions = await withActions(world);
    await actions.movePhotos(source, empty.id, [rows[2]!.id, rows[1]!.id]);
    expect(coverOf(empty.id)).toBe(rows[2]!.id);
  });

  it('never replaces an existing cover of the target', async () => {
    const { world, source, target, rows, coverOf } = pair();
    const targetPhotos = (world.snapshot().photos as PhotoRow[]).filter((p) => p.album_id === target.id);
    await world.ports.catalog.updateAlbum(target.id, { cover_photo_id: targetPhotos.at(-1)!.id });
    const actions = await withActions(world);
    await actions.movePhotos(source, target.id, [rows[1]!.id]);
    expect(coverOf(target.id)).toBe(targetPhotos.at(-1)!.id);
  });
});
