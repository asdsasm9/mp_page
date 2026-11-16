/** Instagram post editor (WP-14 tests 12 and 15): counters, 1..10 photos, picker, save, delete, mark posted with a date, unmark, a11y. */
import type { IgPost } from '@mp/shared';
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeWorld, fixtureSnapshot, type FakeWorld } from '../adapters/fake';
import { seriousViolations } from '../a11y/helpers';
import { App } from '../App';
import { AppProviders } from '../AppProviders';
import { keyboardDrag, mockRowRects } from '../components/keyboardDrag.testutil';
import { cs } from '../i18n/cs';
import { todayLocal } from './PostDialogs';

configure({ getElementError: (message) => new Error(message ?? '') });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const t = cs.instagram.editor;
const seeded = () => createFakeWorld({ signedIn: true, seed: fixtureSnapshot(), plannerSeed: true });
const posts = (world: FakeWorld) => world.ports.planner.listPosts();
const byCaption = async (world: FakeWorld, caption: string): Promise<IgPost> =>
  (await posts(world)).find((p) => p.caption === caption)!;

function mount(world: FakeWorld, path: string) {
  return render(
    <AppProviders ports={world.ports} retry={false} imgBaseUrl="https://img.example.test" siteUrl="https://site.example.test">
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </AppProviders>,
  );
}

const heading = (name: string) => screen.findByRole('heading', { level: 1, name });
const field = (label: string) => screen.getByLabelText(label) as HTMLTextAreaElement | HTMLInputElement;

async function openPicker(user: ReturnType<typeof userEvent.setup>) {
  const button = screen.getByRole('button', { name: new RegExp(`^(${t.choosePhotos}|${t.changePhotos})$`) });
  await user.click(button);
  return screen.findByRole('dialog', { name: cs.instagram.picker.title });
}

/** Ticks the first `n` free photos of the album that is shown in the picker. */
async function tick(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, n: number) {
  await waitFor(() => expect(within(dialog).queryAllByRole('checkbox').length).toBeGreaterThan(0));
  let done = 0;
  for (const box of within(dialog).getAllByRole('checkbox')) {
    if (done >= n) break;
    if (!(box as HTMLInputElement).checked && !(box as HTMLInputElement).disabled) {
      await user.click(box);
      done += 1;
    }
  }
  return done;
}

describe('post editor: new post', () => {
  it('counts caption and hashtags live, by code points', async () => {
    mount(seeded(), '/instagram/novy');
    await heading(cs.instagram.newPost);
    const user = userEvent.setup();
    expect(screen.getByText('0 / 2200 znaků')).toBeTruthy();
    expect(screen.getByText('0 / 30 hashtagů')).toBeTruthy();
    await user.type(field(t.captionLabel), 'Ahoj 😀');
    expect(screen.getByText('6 / 2200 znaků')).toBeTruthy();
    fireEvent.change(field(t.hashtagsLabel), { target: { value: '#svatba #brno text #love' } });
    expect(screen.getByText('3 / 30 hashtagů')).toBeTruthy();
    const live = screen.getByText('6 / 2200 znaků');
    expect(live.getAttribute('role')).toBe('status');
    expect(live.getAttribute('aria-live')).toBe('polite');
  });

  it('warns when the caption is over the limit and when caption plus hashtags are', async () => {
    mount(seeded(), '/instagram/novy');
    await heading(cs.instagram.newPost);
    fireEvent.change(field(t.captionLabel), { target: { value: 'a'.repeat(2201) } });
    expect(screen.getByText(t.captionTooLong)).toBeTruthy();
    fireEvent.change(field(t.captionLabel), { target: { value: 'a'.repeat(2190) } });
    expect(screen.queryByText(t.captionTooLong)).toBeNull();
    expect(screen.queryByText(t.combinedTooLong)).toBeNull();
    fireEvent.change(field(t.hashtagsLabel), { target: { value: '#'.concat('b'.repeat(20)) } });
    expect(screen.getByText(t.combinedTooLong)).toBeTruthy();
    fireEvent.change(field(t.hashtagsLabel), { target: { value: Array.from({ length: 31 }, (_, i) => `#t${i}`).join(' ') } });
    expect(screen.getByText(t.hashtagsTooMany)).toBeTruthy();
  });

  it('refuses to save without photos, and creates nothing', async () => {
    const world = seeded();
    mount(world, '/instagram/novy');
    await heading(cs.instagram.newPost);
    const before = (await posts(world)).length;
    await userEvent.setup().click(screen.getByRole('button', { name: t.save }));
    expect((await screen.findByRole('alert')).textContent).toContain(t.needPhoto);
    expect((await posts(world)).length).toBe(before);
  });

  it('picks photos album by album with order numbers, keeps them across albums and stops at 10', async () => {
    const world = seeded();
    mount(world, '/instagram/novy');
    await heading(cs.instagram.newPost);
    const user = userEvent.setup();
    const dialog = await openPicker(user);
    const albums = within(dialog).getAllByRole('radio');
    expect(albums.length).toBeGreaterThan(1);
    await user.click(albums[0]!);
    expect(await tick(user, dialog, 2)).toBe(2);
    expect(within(dialog).getAllByText('1', { selector: '.ig-pick-order' })).toHaveLength(1);
    expect(within(dialog).getByText('2', { selector: '.ig-pick-order' })).toBeTruthy();
    expect(within(dialog).getByText('Vybráno 2 z 10')).toBeTruthy();
    // Another album, then back: the first two are still chosen and the numbers continue.
    await user.click(albums[1]!);
    await waitFor(() => expect(within(dialog).queryAllByText(/^\d+$/, { selector: '.ig-pick-order' })).toHaveLength(0));
    await tick(user, dialog, 3);
    expect(within(dialog).getByText('Vybráno 5 z 10')).toBeTruthy();
    expect(within(dialog).getByText('3', { selector: '.ig-pick-order' })).toBeTruthy();
    await user.click(albums[0]!);
    await waitFor(() => expect(within(dialog).getByText('2', { selector: '.ig-pick-order' })).toBeTruthy());
    // Fill up to the maximum, wherever the photos are.
    for (const album of albums) {
      if (within(dialog).queryByText(/Vybráno 10 z 10/)) break;
      await user.click(album);
      await tick(user, dialog, 10);
    }
    expect(within(dialog).getByText(/Vybráno 10 z 10/)).toBeTruthy();
    const loose = within(dialog).getAllByRole('checkbox').filter((box) => !(box as HTMLInputElement).checked);
    expect(loose.length).toBeGreaterThan(0);
    expect(loose.every((box) => (box as HTMLInputElement).disabled)).toBe(true);
  });

  it('shows the chosen photos as a strip, saves the post and opens it', async () => {
    const world = seeded();
    mount(world, '/instagram/novy');
    await heading(cs.instagram.newPost);
    const user = userEvent.setup();
    const dialog = await openPicker(user);
    await tick(user, dialog, 3);
    await user.click(within(dialog).getByRole('button', { name: cs.instagram.picker.confirm }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const strip = screen.getByRole('list', { name: t.stripLabel });
    expect(within(strip).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText('Vybráno 3 z 10')).toBeTruthy();
    await user.type(field(t.captionLabel), 'Nový popisek');
    fireEvent.change(field(t.plannedOn), { target: { value: '2026-12-24' } });
    await user.click(screen.getByLabelText(cs.instagram.statusPlanned));
    await user.click(screen.getByRole('button', { name: t.save }));
    await heading(t.editTitle);
    const created = await byCaption(world, 'Nový popisek');
    expect(created.status).toBe('planned');
    expect(created.planned_on).toBe('2026-12-24');
    expect(created.photos.map((p) => p.sort)).toEqual([1, 2, 3]);
  });

  it('removes a photo from the strip and keeps at least one', async () => {
    const world = seeded();
    const post = await byCaption(world, 'Svatba na zámku');
    mount(world, `/instagram/${post.id}`);
    await heading(t.editTitle);
    const user = userEvent.setup();
    expect(await screen.findByText('Vybráno 3 z 10')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Odebrat fotku 2' }));
    expect(screen.getByText('Vybráno 2 z 10')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Odebrat fotku 1' }));
    await user.click(screen.getByRole('button', { name: 'Odebrat fotku 1' }));
    await user.click(screen.getByRole('button', { name: t.save }));
    expect((await screen.findByRole('alert')).textContent).toContain(t.needPhoto);
    expect((await byCaption(world, 'Svatba na zámku')).photos).toHaveLength(3);
  });
});

describe('post editor: existing post', () => {
  it('shows the saved values and saves changes of text, date, status and photo order', async () => {
    mockRowRects();
    const world = seeded();
    const post = await byCaption(world, 'Svatba na zámku');
    mount(world, `/instagram/${post.id}`);
    await heading(t.editTitle);
    const user = userEvent.setup();
    await waitFor(() => expect(field(t.captionLabel).value).toBe('Svatba na zámku'));
    expect(field(t.hashtagsLabel).value).toBe('#svatba #fotografka #brno');
    expect(field(t.plannedOn).value).toBe('2026-11-20');
    expect((screen.getByLabelText(cs.instagram.statusPlanned) as HTMLInputElement).checked).toBe(true);
    // Unsaved changes: marking as posted waits for the save.
    await user.type(field(t.captionLabel), '!');
    expect(screen.getByText(t.saveFirst)).toBeTruthy();
    expect((screen.getByRole('button', { name: t.markPosted }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByLabelText(cs.instagram.statusDraft));
    await keyboardDrag(user, `${cs.reorder.handle}: Fotka 1`, 1);
    await user.click(screen.getByRole('button', { name: t.save }));
    await waitFor(async () => expect((await byCaption(world, 'Svatba na zámku!')).status).toBe('draft'));
    const saved = await byCaption(world, 'Svatba na zámku!');
    expect(saved.photos.map((p) => p.photo_id)).toEqual([post.photos[1]!.photo_id, post.photos[0]!.photo_id, post.photos[2]!.photo_id]);
    await waitFor(() => expect(screen.queryByText(t.saveFirst)).toBeNull());
  });

  it('shows a failed save and keeps what was typed', async () => {
    const world = seeded();
    const post = await byCaption(world, 'Svatba na zámku');
    mount(world, `/instagram/${post.id}`);
    await heading(t.editTitle);
    await waitFor(() => expect(field(t.captionLabel).value).toBe('Svatba na zámku'));
    const user = userEvent.setup();
    world.failNext('planner.updatePost', 'network', 1);
    await user.type(field(t.captionLabel), '?');
    await user.click(screen.getByRole('button', { name: t.save }));
    expect((await screen.findByRole('alert')).textContent).toContain('Chybí připojení k internetu.');
    expect(field(t.captionLabel).value).toBe('Svatba na zámku?');
    await user.click(screen.getByRole('button', { name: t.save }));
    await waitFor(async () => expect((await byCaption(world, 'Svatba na zámku?')).id).toBe(post.id));
  });

  it('a post without photos is a draft with a notice; planning and marking it are refused', async () => {
    const world = seeded();
    const post = await byCaption(world, 'Fotka byla smazána');
    mount(world, `/instagram/${post.id}`);
    await heading(t.editTitle);
    expect(await screen.findByText(t.noPhotosNotice)).toBeTruthy();
    expect(screen.getByText(t.photoRemoved)).toBeTruthy();
    expect((screen.getByLabelText(cs.instagram.statusDraft) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('button', { name: t.markPosted }) as HTMLButtonElement).disabled).toBe(true);
    const user = userEvent.setup();
    await user.click(screen.getByLabelText(cs.instagram.statusPlanned));
    await user.click(screen.getByRole('button', { name: t.save }));
    expect((await screen.findByRole('alert')).textContent).toContain(t.needPhoto);
    expect((await byCaption(world, 'Fotka byla smazána')).status).toBe('planned');
  });

  it('after a conflict, "Načíst znovu" drops the draft so a save cannot overwrite the other edit', async () => {
    const world = seeded();
    const post = await byCaption(world, 'Svatba na zámku');
    mount(world, `/instagram/${post.id}`);
    await heading(t.editTitle);
    await waitFor(() => expect(field(t.captionLabel).value).toBe('Svatba na zámku'));
    const user = userEvent.setup();
    // Another device saves first.
    await world.ports.planner.updatePost(post.id, { caption: 'Změna z jiného zařízení' });
    await user.type(field(t.captionLabel), ' moje');
    await user.click(screen.getByRole('button', { name: t.save }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(cs.data.staleSentenceBy.post);
    expect((await byCaption(world, 'Změna z jiného zařízení')).id).toBe(post.id);
    await user.click(within(alert).getByRole('button', { name: cs.data.reload }));
    await waitFor(() => expect(field(t.captionLabel).value).toBe('Změna z jiného zařízení'));
    expect(screen.queryByRole('alert')).toBeNull();
    await user.click(screen.getByRole('button', { name: t.save }));
    await waitFor(() => expect(screen.queryByText(t.saveFirst)).toBeNull());
    expect((await byCaption(world, 'Změna z jiného zařízení')).id).toBe(post.id);
  });

  it('a planned post without photos that gets photos and keeps "Koncept" is saved as a draft', async () => {
    const world = seeded();
    const post = await byCaption(world, 'Fotka byla smazána');
    expect(post.status).toBe('planned');
    mount(world, `/instagram/${post.id}`);
    await heading(t.editTitle);
    const user = userEvent.setup();
    await waitFor(() => expect(field(t.captionLabel).value).toBe('Fotka byla smazána'));
    const dialog = await openPicker(user);
    await tick(user, dialog, 2);
    await user.click(within(dialog).getByRole('button', { name: cs.instagram.picker.confirm }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((screen.getByLabelText(cs.instagram.statusDraft) as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByRole('button', { name: t.save }));
    await waitFor(async () => expect((await byCaption(world, 'Fotka byla smazána')).photos).toHaveLength(2));
    expect((await byCaption(world, 'Fotka byla smazána')).status).toBe('draft');
  });

  it('keeps the focus in the strip after "Odebrat", and moves it to "Vybrat fotky" after the last one', async () => {
    const world = seeded();
    const post = await byCaption(world, 'Svatba na zámku');
    mount(world, `/instagram/${post.id}`);
    await heading(t.editTitle);
    const user = userEvent.setup();
    await screen.findByText('Vybráno 3 z 10');
    const remove = (n: number) => screen.getByRole('button', { name: `Odebrat fotku ${n}` });
    remove(2).focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(document.activeElement).toBe(remove(2)));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(document.activeElement).toBe(remove(1)));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: t.choosePhotos })));
  });

  it('marks a post as posted on a chosen date, then returns it to planned', async () => {
    const world = seeded();
    const post = await byCaption(world, 'Portrét v ateliéru');
    mount(world, `/instagram/${post.id}`);
    await heading(t.editTitle);
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByRole('button', { name: t.markPosted })).toBeTruthy());
    await waitFor(() => expect((screen.getByRole('button', { name: t.markPosted }) as HTMLButtonElement).disabled).toBe(false));
    await user.click(screen.getByRole('button', { name: t.markPosted }));
    const dialog = await screen.findByRole('dialog', { name: cs.instagram.markDialog.title });
    expect(within(dialog).getByText(cs.instagram.markDialog.hint)).toBeTruthy();
    const date = within(dialog).getByLabelText(new RegExp(cs.instagram.markDialog.dateLabel)) as HTMLInputElement;
    expect(date.value).toBe(todayLocal());
    fireEvent.change(date, { target: { value: '2999-01-01' } });
    await user.click(within(dialog).getByRole('button', { name: cs.instagram.markDialog.confirm }));
    expect(within(dialog).getByText(cs.instagram.markDialog.dateFuture)).toBeTruthy();
    expect((await byCaption(world, 'Portrét v ateliéru')).status).toBe('planned');
    fireEvent.change(date, { target: { value: '2026-10-01' } });
    await user.click(within(dialog).getByRole('button', { name: cs.instagram.markDialog.confirm }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const posted = await byCaption(world, 'Portrét v ateliéru');
    expect(posted.status).toBe('posted');
    expect(posted.posted_at).toMatch(/^2026-10-01T/);
    expect(await screen.findByText('Zveřejněno 1. 10. 2026')).toBeTruthy();
    expect(screen.queryByLabelText(cs.instagram.statusDraft)).toBeNull();
    await user.click(screen.getByRole('button', { name: t.unmark }));
    await waitFor(async () => expect((await byCaption(world, 'Portrét v ateliéru')).status).toBe('planned'));
    expect((await byCaption(world, 'Portrét v ateliéru')).posted_at).toBeNull();
    expect(await screen.findByRole('button', { name: t.markPosted })).toBeTruthy();
  });

  it('deletes only after a confirmation and leaves the photos in the albums', async () => {
    const world = seeded();
    const post = await byCaption(world, 'Rozepsaný příspěvek');
    const photoCount = world.snapshot().photos.length;
    const total = (await posts(world)).length;
    mount(world, `/instagram/${post.id}`);
    await heading(t.editTitle);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: t.deleteButton }));
    const dialog = await screen.findByRole('dialog', { name: cs.instagram.deleteDialog.title });
    expect(within(dialog).getByText(cs.instagram.deleteDialog.body)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: cs.glossary.cancel }));
    expect((await posts(world)).length).toBe(total);
    await user.click(screen.getByRole('button', { name: t.deleteButton }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: cs.glossary.delete }));
    await heading(cs.routes.instagram.title);
    expect((await posts(world)).length).toBe(total - 1);
    expect(world.snapshot().photos.length).toBe(photoCount);
  });

  it('says so when the post does not exist', async () => {
    mount(seeded(), '/instagram/00000000-0000-4000-8000-000000000000');
    expect(await screen.findByText(t.notFound)).toBeTruthy();
    expect(screen.getByRole('link', { name: t.backToPlan }).getAttribute('href')).toBe('/instagram');
  });

  it('opens the picker with the keyboard and gives the focus back on Escape', async () => {
    const world = seeded();
    const post = await byCaption(world, 'Svatba na zámku');
    mount(world, `/instagram/${post.id}`);
    await heading(t.editTitle);
    const user = userEvent.setup();
    const button = await screen.findByRole('button', { name: t.changePhotos });
    button.focus();
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: cs.instagram.picker.title });
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(button);
  });

  it('axe: no serious or critical violations in the editor, the picker and the dialogs', async () => {
    const world = seeded();
    const post = await byCaption(world, 'Portrét v ateliéru');
    mount(world, '/instagram/novy');
    await heading(cs.instagram.newPost);
    expect(await seriousViolations()).toEqual([]);
    const user = userEvent.setup();
    const picker = await openPicker(user);
    await tick(user, picker, 2);
    expect(await seriousViolations()).toEqual([]);
    cleanup();

    mount(world, `/instagram/${post.id}`);
    await heading(t.editTitle);
    await waitFor(() => expect(field(t.captionLabel).value).toBe('Portrét v ateliéru'));
    expect(await seriousViolations()).toEqual([]);
    await user.click(screen.getByRole('button', { name: t.markPosted }));
    await screen.findByRole('dialog', { name: cs.instagram.markDialog.title });
    expect(await seriousViolations()).toEqual([]);
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: t.deleteButton }));
    await screen.findByRole('dialog', { name: cs.instagram.deleteDialog.title });
    expect(await seriousViolations()).toEqual([]);
  });
});
