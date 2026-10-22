/**
 * WP5-27 audit, part 2: a keyboard-only session in jsdom. Nothing is clicked: every control is reached with Tab and
 * operated with Enter, Space or typing. Creates a category and an album, edits alt text, moves a photo, deletes one.
 */
import type { AlbumRow, CategoryRow, PhotoRow } from '@mp/shared';
import { cleanup, configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cs, glossary } from '../i18n/cs';
import { heading1, makeWorld, mount, pickFixture, tabTo } from './helpers';

configure({ getElementError: (message) => new Error(message ?? '') });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const NEW_CATEGORY = 'Klávesnice';
const NEW_ALBUM = 'Cílové album';
const ALT = 'Pár u oltáře za soumraku';

describe('keyboard-only flow', () => {
  it('creates a category and an album, edits alt text, moves a photo and deletes one', async () => {
    const world = makeWorld();
    const f = pickFixture(world);
    const user = userEvent.setup();
    mount(world, '/');
    await heading1(cs.routes.categories.title);
    const notOnBody = () => expect(document.activeElement).not.toBe(document.body);

    /** Tab to the control and press Enter. */
    const press = async (control: HTMLElement) => {
      await tabTo(user, control);
      await user.keyboard('{Enter}');
    };
    const bySnapshot = <T,>(key: 'categories' | 'albums' | 'photos') => world.snapshot()[key] as T[];

    // 1. New category: open with Enter, type the name, submit with Enter inside the field.
    const newCategory = await screen.findByRole('button', { name: glossary.newCategory });
    await press(newCategory);
    const dialog = await screen.findByRole('dialog', { name: glossary.newCategory });
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard(NEW_CATEGORY);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(bySnapshot<CategoryRow>('categories').some((c) => c.name === NEW_CATEGORY)).toBe(true);
    expect(document.activeElement).toBe(newCategory);

    // 2. Into the new category, then New album (a draft, opened right away).
    await press(await screen.findByRole('link', { name: NEW_CATEGORY }));
    await heading1(NEW_CATEGORY);
    await waitFor(() => expect(screen.getAllByRole('button', { name: glossary.newAlbum }).length).toBeGreaterThan(0));
    await press(screen.getAllByRole('button', { name: glossary.newAlbum })[0]!);
    await screen.findByRole('dialog', { name: glossary.newAlbum });
    await user.keyboard(NEW_ALBUM);
    await user.keyboard('{Enter}');
    await heading1(NEW_ALBUM);
    expect(bySnapshot<AlbumRow>('albums').some((a) => a.title === NEW_ALBUM)).toBe(true);
    notOnBody();

    // 3. Back to the categories through the breadcrumb, into the album with the photos.
    const crumbs = within(await screen.findByRole('navigation', { name: cs.categoryDetail.breadcrumbLabel }));
    await press(crumbs.getByRole('link', { name: cs.nav.categories }));
    await heading1(cs.routes.categories.title);
    await press(await screen.findByRole('link', { name: f.category.name }));
    await heading1(f.category.name);
    await press(await screen.findByRole('link', { name: f.album.title }));
    await heading1(f.album.title);
    await screen.findByRole('button', { name: 'Akce s fotkou 1' });

    // 4. Alt text: tile menu -> "Upravit popisek" -> type in the field -> Save with Enter.
    await press(screen.getByRole('button', { name: 'Akce s fotkou 1' }));
    await screen.findByRole('dialog', { name: 'Fotka 1' });
    await press(screen.getByRole('link', { name: cs.photos.editCaption }));
    await heading1(/^Fotka 1 z \d+$/);
    const alt = screen.getByLabelText(glossary.altText) as HTMLTextAreaElement;
    await tabTo(user, alt);
    await user.keyboard('{Control>}a{/Control}');
    await user.keyboard(ALT);
    await press(screen.getByRole('button', { name: glossary.save }));
    await screen.findByText(glossary.saved);
    const first = f.photos[0]!;
    expect(bySnapshot<PhotoRow>('photos').find((p) => p.id === first.id)!.alt).toBe(ALT);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: glossary.save }));

    // 5. Back to the album, move photo 2 to the new album: menu, dialog, search, radio with Space, Move.
    await press(screen.getByRole('link', { name: cs.photos.detail.backToAlbum }));
    await heading1(f.album.title);
    const moving = f.photos[1]!;
    await press(await screen.findByRole('button', { name: 'Akce s fotkou 2' }));
    await screen.findByRole('dialog', { name: 'Fotka 2' });
    await press(screen.getByRole('button', { name: cs.photos.moveToOtherAlbum }));
    await screen.findByRole('dialog', { name: cs.photos.moveDialogTitle });
    await user.keyboard('Cílové');
    const radio = await screen.findByRole('radio', { name: NEW_ALBUM });
    await tabTo(user, radio);
    await user.keyboard(' ');
    expect((radio as HTMLInputElement).checked).toBe(true);
    await press(screen.getByRole('button', { name: glossary.move }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const target = bySnapshot<AlbumRow>('albums').find((a) => a.title === NEW_ALBUM)!;
    await waitFor(() => expect(bySnapshot<PhotoRow>('photos').find((p) => p.id === moving.id)!.album_id).toBe(target.id));
    notOnBody();

    // 6. Delete a photo: menu, "Smazat fotku", confirm with Enter.
    const doomed = f.photos[2]!;
    await waitFor(() => expect(document.querySelectorAll('.photo-tile')).toHaveLength(f.photos.length - 1));
    await press(screen.getByRole('button', { name: 'Akce s fotkou 2' }));
    await screen.findByRole('dialog', { name: 'Fotka 2' });
    await press(screen.getByRole('button', { name: cs.delete.photo }));
    const confirm = await screen.findByRole('dialog');
    await press(within(confirm).getByRole('button', { name: glossary.delete }));
    await waitFor(() => expect(bySnapshot<PhotoRow>('photos').some((p) => p.id === doomed.id)).toBe(false));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.querySelectorAll('.photo-tile')).toHaveLength(f.photos.length - 2);
    notOnBody();
  }, 60_000);
});
