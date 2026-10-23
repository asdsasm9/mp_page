/**
 * The fake change_log against the scenarios shared with the SQL trigger test
 * (packages/shared/src/change-log-scenarios.ts, supabase/tests/change-log.test.ts).
 */
import { allKeys, variantBytes, variantPlan, type PhotoVariants } from '@mp/shared';
import { describe, expect, it } from 'vitest';
import { CHANGE_SCENARIOS, type ScenarioOp } from '../../../../../packages/shared/src/change-log-scenarios';
import { createFakeWorld, type FakeWorld } from './index';

const PHOTO_IDS: Record<string, string> = {
  P1: 'cccccccc-0000-4000-8000-000000000001',
  P2: 'cccccccc-0000-4000-8000-000000000002',
};

function variants(): PhotoVariants {
  const p = variantPlan(1200, 800);
  const bytes = 1000;
  return {
    master: { w: p.master.w, h: p.master.h, bytes },
    webp: p.webp.map((e) => ({ tier: e.tier as 480, w: e.w, h: e.h, bytes })),
    jpeg: { w: p.jpeg.w, h: p.jpeg.h, bytes },
    og: { w: p.og.w, h: p.og.h, bytes },
  };
}

/** The published baseline of the scenario table: two categories, two albums, photo P1; log empty. */
async function baseline() {
  const world = createFakeWorld({ signedIn: true });
  const { catalog } = world.ports;
  const ids: Record<string, string> = {};
  ids.svatby = (await catalog.createCategory({ slug: 'svatby', name: 'Svatby' })).id;
  ids.portrety = (await catalog.createCategory({ slug: 'portrety', name: 'Portréty' })).id;
  ids.one = (await catalog.createAlbum({ category_id: ids.svatby, slug: 'one', title: 'První', published: true })).id;
  ids.two = (await catalog.createAlbum({ category_id: ids.portrety, slug: 'two', title: 'Druhé', published: true })).id;
  await addPhoto(world, 'P1', ids.one, 'Nevěsta');
  // A publish writes the lines up to now off, as the real record_publish does.
  await world.ports.api.publish();
  expect(world.snapshot().changeLog).toEqual([]);
  return { world, ids };
}

async function addPhoto(world: FakeWorld, ref: string, albumId: string, alt?: string) {
  const v = variants();
  const photo_id = PHOTO_IDS[ref]!;
  const sizes = variantBytes(v);
  allKeys(photo_id, v).forEach((key, i) => world.putObject(key, sizes[i]!));
  await world.ports.api.commit({
    photo_id,
    album_id: albumId,
    width: 1200,
    height: 800,
    variants: v,
    bytes_total: sizes.reduce((a, b) => a + b, 0),
    ...(alt === undefined ? {} : { alt }),
  });
}

async function run(world: FakeWorld, ids: Record<string, string>, o: ScenarioOp) {
  const { catalog, api } = world.ports;
  switch (o.op) {
    case 'addCategory':
      ids[o.ref] = (await catalog.createCategory({ slug: o.ref, name: o.name })).id;
      return;
    case 'addAlbum':
      ids[o.ref] = (await catalog.createAlbum({ category_id: ids[o.category]!, slug: o.ref, title: o.title })).id;
      return;
    case 'addPhoto':
      return addPhoto(world, o.ref, ids[o.album]!, o.alt);
    case 'setCategory':
      await catalog.updateCategory(ids[o.ref]!, o.set);
      return;
    case 'setAlbum': {
      const { cover, ...rest } = o.set;
      await catalog.updateAlbum(ids[o.ref]!, {
        ...rest,
        ...(cover === undefined ? {} : { cover_photo_id: cover === null ? null : PHOTO_IDS[cover]! }),
      });
      return;
    }
    case 'setPhoto': {
      const { album, ...rest } = o.set;
      await catalog.updatePhoto(PHOTO_IDS[o.ref]!, { ...rest, ...(album === undefined ? {} : { album_id: ids[album]! }) });
      return;
    }
    case 'deletePhoto':
      await api.deletePhotos({ ids: [PHOTO_IDS[o.ref]!] });
      return;
  }
}

describe('fake change_log: shared scenarios', () => {
  it.each(CHANGE_SCENARIOS.map((s) => [s.name, s] as const))('%s', async (_name, scenario) => {
    const { world, ids } = await baseline();
    for (const o of scenario.ops) await run(world, ids, o);
    const lines = [...world.snapshot().changeLog].sort((a, b) => a.id - b.id);
    expect(lines.map((l) => [l.table_name, l.kind, l.label, l.category_name, l.album_title])).toEqual(
      scenario.lines.map((l) => [...l]),
    );
  });
});
