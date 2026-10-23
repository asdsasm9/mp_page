/**
 * WP5-27 audit, part 1: axe (serious and critical, WCAG 2.2 AA tags) in every screen state, dialog and the upload
 * drawer, and every dialog hands focus back to the control that opened it.
 */
import { cleanup, configure, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeWorld, createSeqIds, fixtureSnapshot } from '../adapters/fake';
import { cs, glossary } from '../i18n/cs';
import { systemClock } from '../ports';
import { pickedFile, stubEncoder } from '../upload/testing';
import { heading1, makeWorld, mount, pickFixture, seriousViolations } from './helpers';

configure({ getElementError: (message) => new Error(message ?? '') });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type User = ReturnType<typeof userEvent.setup>;
const button = (name: string | RegExp) => screen.findByRole('button', { name });

interface Case {
  name: string;
  path: (f: ReturnType<typeof pickFixture>) => string;
  heading: (f: ReturnType<typeof pickFixture>) => string | RegExp;
  steps?: (user: User, f: ReturnType<typeof pickFixture>) => Promise<void>;
  /** The control that opens the dialog the steps leave open, and the dialog's name; used by the focus test too. */
  dialog?: { opener: (f: ReturnType<typeof pickFixture>) => Promise<HTMLElement>; name: (f: ReturnType<typeof pickFixture>) => RegExp | string };
}

const cases: Case[] = [
  { name: '404', path: () => '/nic-tu-neni', heading: () => cs.notFound.title },
  { name: 'categories', path: () => '/', heading: () => cs.routes.categories.title },
  {
    name: 'categories: new category dialog',
    path: () => '/',
    heading: () => cs.routes.categories.title,
    dialog: { opener: () => button(glossary.newCategory), name: () => glossary.newCategory },
  },
  {
    name: 'categories: rename dialog',
    path: () => '/',
    heading: () => cs.routes.categories.title,
    dialog: { opener: (f) => button(`${cs.categories.edit}: ${f.category.name}`), name: () => cs.categories.editTitle },
  },
  {
    name: 'categories: hide dialog',
    path: () => '/',
    heading: () => cs.routes.categories.title,
    dialog: { opener: (f) => button(`${cs.categories.hide}: ${f.category.name}`), name: (f) => new RegExp(`^Skrýt kategorii ${f.category.name}`) },
  },
  {
    name: 'categories: delete dialog (category has albums)',
    path: () => '/',
    heading: () => cs.routes.categories.title,
    dialog: { opener: (f) => button(`${glossary.delete}: ${f.category.name}`), name: (f) => new RegExp(`^Smazat kategorii ${f.category.name}`) },
  },
  { name: 'category detail', path: (f) => `/kategorie/${f.category.id}`, heading: (f) => f.category.name },
  {
    name: 'category detail: new album dialog',
    path: (f) => `/kategorie/${f.category.id}`,
    heading: (f) => f.category.name,
    dialog: { opener: () => button(glossary.newAlbum), name: () => glossary.newAlbum },
  },
  {
    name: 'category detail: edit category dialog',
    path: (f) => `/kategorie/${f.category.id}`,
    heading: (f) => f.category.name,
    dialog: { opener: () => button(cs.categoryDetail.edit), name: () => cs.categories.editTitle },
  },
  {
    name: 'category detail: move album dialog',
    path: (f) => `/kategorie/${f.category.id}`,
    heading: (f) => f.category.name,
    dialog: { opener: (f) => button(`${cs.categoryDetail.moveToCategory}: ${f.album.title}`), name: (f) => new RegExp(`^Přesunout album ${f.album.title}`) },
  },
  {
    name: 'category detail: delete album dialog',
    path: (f) => `/kategorie/${f.category.id}`,
    heading: (f) => f.category.name,
    dialog: { opener: (f) => button(`${cs.delete.album}: ${f.album.title}`), name: (f) => new RegExp(`^Smazat album ${f.album.title}`) },
  },
  { name: 'album', path: (f) => `/alba/${f.album.id}`, heading: (f) => f.album.title },
  {
    name: 'album: delete album dialog',
    path: (f) => `/alba/${f.album.id}`,
    heading: (f) => f.album.title,
    dialog: { opener: () => button(cs.delete.album), name: (f) => new RegExp(`^Smazat album ${f.album.title}`) },
  },
  {
    name: 'album: tile menu',
    path: (f) => `/alba/${f.album.id}`,
    heading: (f) => f.album.title,
    dialog: { opener: () => button(/^Akce s fotkou 1$/), name: () => 'Fotka 1' },
  },
  {
    name: 'album: tile menu then move-photo dialog',
    path: (f) => `/alba/${f.album.id}`,
    heading: (f) => f.album.title,
    steps: async (user) => {
      await user.click(await button(/^Akce s fotkou 1$/));
      await user.click(await button(cs.photos.moveToOtherAlbum));
    },
    dialog: undefined,
  },
  {
    name: 'album: selection mode',
    path: (f) => `/alba/${f.album.id}`,
    heading: (f) => f.album.title,
    steps: async (user) => {
      await user.click(await button(cs.photos.select));
      await user.click(await screen.findByRole('checkbox', { name: 'Vybrat fotku 1' }));
    },
  },
  {
    name: 'photo detail',
    path: (f) => `/alba/${f.album.id}/foto/${f.photos[0]!.id}`,
    heading: () => /^Fotka 1 z \d+$/,
  },
  { name: 'publish', path: () => '/zverejnit', heading: () => cs.routes.publish.title },
  { name: 'storage', path: () => '/ulozeni', heading: () => cs.routes.storage.title },
  { name: 'upload page, empty queue', path: () => '/nahravani', heading: () => cs.routes.upload.title },
];

async function run(c: Case, openDialog: boolean) {
  const world = makeWorld();
  const f = pickFixture(world);
  const user = userEvent.setup();
  mount(world, c.path(f));
  await heading1(c.heading(f));
  // Wait for the data the opener depends on (album lists and photos load after the heading).
  await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
  return { world, f, user, openDialog };
}

describe('axe: every screen state and dialog has no serious or critical violations', () => {
  it.each(cases)('$name', async (c) => {
    const { f, user } = await run(c, true);
    if (c.dialog) {
      const opener = await c.dialog.opener(f);
      await user.click(opener);
      await screen.findByRole('dialog', { name: c.dialog.name(f) });
    }
    if (c.steps) {
      await c.steps(user, f);
      if (c.name.includes('move-photo')) await screen.findByRole('dialog', { name: cs.photos.moveDialogTitle });
    }
    expect(await seriousViolations()).toEqual([]);
  });

  it('login (signed out)', async () => {
    const world = createFakeWorld({ seed: fixtureSnapshot() });
    mount(world, '/prihlaseni');
    await heading1(cs.routes.login.title);
    expect(await seriousViolations()).toEqual([]);
  });

  it('storage bar in the warning and the full state', async () => {
    for (const [limits, level] of [
      [{ quotaHardBytes: 100_000_000_000, quotaWarnBytes: 1 }, 'warn'],
      [{ quotaHardBytes: 1, quotaWarnBytes: 1 }, 'full'],
    ] as const) {
      const world = makeWorld({ limits });
      mount(world, '/ulozeni');
      await heading1(cs.routes.storage.title);
      await waitFor(() => expect(document.querySelector(`.storage-large[data-level="${level}"]`)).not.toBeNull());
      expect(await seriousViolations()).toEqual([]);
      cleanup();
    }
  });

  it('the session-expired modal', async () => {
    const world = makeWorld();
    mount(world, '/ulozeni');
    await heading1(cs.routes.storage.title);
    await screen.findByRole('table', { name: cs.storageScreen.breakdownCaption });
    world.expireSession();
    await userEvent.setup().click(await button(glossary.checkStorage));
    await screen.findByRole('dialog', { name: cs.login.expired.title });
    expect(await seriousViolations()).toEqual([]);
  });

  it('the upload drawer while a file is uploading and when it is done, and the duplicate prompt', async () => {
    const world = createFakeWorld({
      clock: systemClock,
      ids: createSeqIds('aaaaaaaa'),
      signedIn: true,
      seed: fixtureSnapshot(),
    });
    const f = pickFixture(world);
    world.slowPut(400);
    mount(world, `/alba/${f.album.id}`, stubEncoder());
    await heading1(f.album.title);
    const input = await waitFor(() => {
      const el = document.querySelector<HTMLInputElement>('input[type="file"]');
      expect(el).not.toBeNull();
      return el!;
    });
    fireEvent.change(input, { target: { files: [pickedFile('IMG_1.jpg')] } });
    await waitFor(() => expect(document.querySelector('li.upload-row')).not.toBeNull(), { timeout: 10_000 });
    expect(await seriousViolations()).toEqual([]);
    await screen.findByText('Nahráno 1 fotka.', {}, { timeout: 15_000 });
    expect(await seriousViolations()).toEqual([]);

    fireEvent.change(input, { target: { files: [pickedFile('IMG_1.jpg')] } });
    await screen.findByRole('dialog', { name: cs.upload.duplicateOne });
    expect(await seriousViolations()).toEqual([]);
  }, 40_000);
});

describe('every dialog returns focus to the control that opened it', () => {
  const withDialog = cases.filter((c) => c.dialog);
  it.each(withDialog)('$name: Escape', async (c) => {
    const { f, user } = await run(c, true);
    const opener = await c.dialog!.opener(f);
    opener.focus();
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: c.dialog!.name(f) });
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it('the Cancel button returns focus too', async () => {
    const c = withDialog.find((x) => x.name.includes('delete album dialog') && x.name.startsWith('album'))!;
    const { f, user } = await run(c, true);
    const opener = await c.dialog!.opener(f);
    opener.focus();
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: glossary.cancel }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it('a menu that opens a second dialog: closing the second returns to the tile button, and Escape on a dialog whose opener vanished lands on the main region', async () => {
    const { f, user } = await run(cases.find((c) => c.name === 'album')!, true);
    const tileButton = await button(/^Akce s fotkou 2$/);
    tileButton.focus();
    await user.keyboard('{Enter}');
    await user.click(await button(cs.photos.moveToOtherAlbum));
    await screen.findByRole('dialog', { name: cs.photos.moveDialogTitle });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(tileButton);

    // Delete the photo: the tile (and so the opener) is gone afterwards; focus must not fall to the page body.
    await user.keyboard('{Enter}');
    await user.click(await button(cs.delete.photo));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: glossary.delete }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 5000 });
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.tagName).not.toBe('BODY');
    expect(f.photos.length).toBeGreaterThan(2);
  });
});
