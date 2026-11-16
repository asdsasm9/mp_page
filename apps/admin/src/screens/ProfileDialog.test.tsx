/**
 * "Upravit profil" dialog (WP-15 step 9, T-364): fields and limits with Czech messages, the bio counter, the explicit save with the
 * updated_at precondition, the stale notice with "Načíst znovu", the avatar picker in single-choice mode with "Odebrat fotku",
 * focus back on the opening button, the disabled button when the profile could not be loaded, and the avatar in the header after the save.
 */
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeWorld, fixtureSnapshot, type FakeWorld } from '../adapters/fake';
import { seriousViolations } from '../a11y/helpers';
import { App } from '../App';
import { AppProviders } from '../AppProviders';
import { cs, glossary } from '../i18n/cs';

configure({ getElementError: (message) => new Error(message ?? '') });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const t = cs.instagram.profile.dialog;
const seeded = () => createFakeWorld({ signedIn: true, seed: fixtureSnapshot(), plannerSeed: true });

function mount(world: FakeWorld) {
  return render(
    <AppProviders ports={world.ports} retry={false} imgBaseUrl="https://img.example.test" siteUrl="https://site.example.test">
      <MemoryRouter initialEntries={['/instagram']}>
        <App />
      </MemoryRouter>
    </AppProviders>,
  );
}

type User = ReturnType<typeof userEvent.setup>;

const editButton = () => screen.getByRole('button', { name: cs.instagram.profile.edit }) as HTMLButtonElement;
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement | HTMLTextAreaElement;
const profileDialog = () => screen.findByRole('dialog', { name: t.title });
const save = (dialog: HTMLElement) => within(dialog).getByRole('button', { name: t.save });
const photoIdOf = (world: FakeWorld) => (world.snapshot().photos as { id: string }[])[0]!.id;

async function open(user: User) {
  await screen.findByRole('list', { name: cs.instagram.gridLabel });
  await waitFor(() => expect(editButton().disabled).toBe(false));
  await user.click(editButton());
  return profileDialog();
}

async function change(user: User, label: string, value: string) {
  const el = field(label);
  await user.clear(el);
  if (value !== '') await user.type(el, value);
}

describe('Upravit profil button', () => {
  it('is a real button in the profile header that opens the dialog; the archive and share shapes stay decorative', async () => {
    mount(seeded());
    const user = userEvent.setup();
    const dialog = await open(user);
    expect(within(dialog).getByRole('heading', { level: 2, name: t.title })).toBeTruthy();
    const header = document.querySelector('.ig-profile')!;
    expect(header.querySelectorAll('.ig-actions button')).toHaveLength(1);
    expect(header.querySelectorAll('.ig-tabs button, .ig-counts button')).toHaveLength(0);
    for (const el of header.querySelectorAll('.ig-fake-button, .ig-tabs')) expect(el.getAttribute('aria-hidden')).toBe('true');
  });

  it('is disabled while the profile could not be loaded (the defaults are shown), and the grid still works', async () => {
    const world = seeded();
    world.failNext('planner.getProfile', 'network', 1);
    mount(world);
    expect(await screen.findByText(cs.instagram.profile.loadFailed)).toBeTruthy();
    expect(editButton().disabled).toBe(true);
    expect(screen.getAllByRole('listitem').length).toBeGreaterThan(5);
  });
});

describe('Upravit profil dialog', () => {
  it('starts with the saved values, the first field focused, and a counter for the bio', async () => {
    const world = seeded();
    await world.ports.planner.updateProfile({ username: 'mullny.photos', display_name: 'Fotograf', bio: 'Brno', link: 'https://example.test/x', followers_count: 12345, following_count: 87 });
    mount(world);
    const user = userEvent.setup();
    const dialog = await open(user);
    expect((field(t.username) as HTMLInputElement).value).toBe('mullny.photos');
    expect((field(t.name) as HTMLInputElement).value).toBe('Fotograf');
    expect((field(t.bio) as HTMLTextAreaElement).value).toBe('Brno');
    expect((field(t.link) as HTMLInputElement).value).toBe('https://example.test/x');
    expect((field(t.followers) as HTMLInputElement).value).toBe('12345');
    expect((field(t.following) as HTMLInputElement).value).toBe('87');
    expect(document.activeElement).toBe(field(t.username));
    expect(within(dialog).getByText('4 / 150 znaků')).toBeTruthy();
  });

  it('counts the bio by code points and allows line breaks', async () => {
    mount(seeded());
    const user = userEvent.setup();
    const dialog = await open(user);
    fireEvent.change(field(t.bio), { target: { value: 'Řádek 1\nŘádek 2 😀' } });
    expect(within(dialog).getByText('17 / 150 znaků')).toBeTruthy();
    expect(within(dialog).queryByText(t.bioTooLong)).toBeNull();
    fireEvent.change(field(t.bio), { target: { value: 'a'.repeat(151) } });
    expect(within(dialog).getByText('151 / 150 znaků')).toBeTruthy();
    expect(within(dialog).getAllByText(t.bioTooLong).length).toBeGreaterThan(0);
  });

  it.each([
    ['username', t.username, 'jméno s mezerou', t.usernameInvalid],
    ['username', t.username, 'a'.repeat(31), t.usernameTooLong],
    ['name', t.name, 'n'.repeat(65), t.nameTooLong],
    ['link', t.link, 'www.example.test', t.linkInvalid],
    ['link', t.link, `https://${'a'.repeat(200)}`, t.linkTooLong],
    ['followers', t.followers, '12,5', t.countInvalid],
    ['following', t.following, '', t.countInvalid],
    ['followers', t.followers, '1000000000', t.countInvalid],
  ])('refuses %s "%s" with the Czech message and moves focus to that field', async (_key, label, value, message) => {
    const world = seeded();
    const spy = vi.spyOn(world.ports.planner, 'updateProfile');
    mount(world);
    const user = userEvent.setup();
    const dialog = await open(user);
    fireEvent.change(field(label), { target: { value } });
    await user.click(save(dialog));
    const error = await within(dialog).findByText(message);
    expect(error.className).toContain('field-error');
    expect(field(label).getAttribute('aria-invalid')).toBe('true');
    expect(field(label).getAttribute('aria-describedby')).toContain(error.id);
    await waitFor(() => expect(document.activeElement).toBe(field(label)));
    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: t.title })).toBeTruthy();
  });

  it('accepts the limits exactly: 30 character username, 64 character name, 150 character bio, 999999999 counts, empty link', async () => {
    const world = seeded();
    mount(world);
    const user = userEvent.setup();
    const dialog = await open(user);
    fireEvent.change(field(t.username), { target: { value: 'u'.repeat(30) } });
    fireEvent.change(field(t.name), { target: { value: 'n'.repeat(64) } });
    fireEvent.change(field(t.bio), { target: { value: 'b'.repeat(150) } });
    fireEvent.change(field(t.link), { target: { value: '' } });
    fireEvent.change(field(t.followers), { target: { value: '999 999 999' } });
    fireEvent.change(field(t.following), { target: { value: '0' } });
    await user.click(save(dialog));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: t.title })).toBeNull());
    const row = await world.ports.planner.getProfile();
    expect([row.username.length, row.display_name.length, row.bio.length, row.followers_count, row.following_count]).toEqual([30, 64, 150, 999999999, 0]);
  });

  it('saves only on "Uložit": the header shows the new values, a toast says Uloženo, and focus is back on "Upravit profil"', async () => {
    const world = seeded();
    mount(world);
    const user = userEvent.setup();
    const dialog = await open(user);
    await change(user, t.username, 'nove.jmeno');
    await change(user, t.name, 'Nové jméno');
    fireEvent.change(field(t.bio), { target: { value: 'Řádek 1\nŘádek 2' } });
    await change(user, t.link, 'https://example.test/odkaz');
    await change(user, t.followers, '12345');
    await change(user, t.following, '87');
    expect((await world.ports.planner.getProfile()).username).toBe('mullnyphotos');
    await user.click(save(dialog));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: t.title })).toBeNull());
    expect(await screen.findByText(t.saved)).toBeTruthy();
    const frame = screen.getByRole('region', { name: cs.instagram.profile.label });
    expect(within(frame).getByRole('heading', { level: 2, name: 'nove.jmeno' })).toBeTruthy();
    expect(within(frame).getByText('Nové jméno')).toBeTruthy();
    expect(frame.querySelector('.ig-bio')!.textContent).toBe('Řádek 1\nŘádek 2');
    expect(frame.querySelector('.ig-profile-link')!.textContent).toBe('https://example.test/odkaz');
    expect(within(frame).getByRole('list', { name: cs.instagram.profile.countsLabel }).textContent).toContain('87 sleduje');
    expect(document.activeElement).toBe(editButton());
    const row = await world.ports.planner.getProfile();
    expect([row.bio, row.followers_count]).toEqual(['Řádek 1\nŘádek 2', 12345]);
  });

  it('closes without saving on "Zrušit" and on Escape, and gives the focus back to "Upravit profil"', async () => {
    const world = seeded();
    mount(world);
    const user = userEvent.setup();
    let dialog = await open(user);
    await change(user, t.name, 'Nezapsané');
    await user.click(within(dialog).getByRole('button', { name: glossary.cancel }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: t.title })).toBeNull());
    expect(document.activeElement).toBe(editButton());
    dialog = await open(user);
    expect((field(t.name) as HTMLInputElement).value).toBe('Mullny Photos');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: t.title })).toBeNull());
    expect(document.activeElement).toBe(editButton());
    expect((await world.ports.planner.getProfile()).display_name).toBe('Mullny Photos');
  });

  it('sends the updated_at it was based on: another device changed the profile, so it shows the stale notice, keeps the other values', async () => {
    const world = seeded();
    mount(world);
    const user = userEvent.setup();
    const dialog = await open(user);
    await world.ports.planner.updateProfile({ bio: 'Změněno jinde' });
    await change(user, t.name, 'Moje změna');
    await user.click(save(dialog));
    const notice = await within(dialog).findByRole('alert');
    expect(notice.textContent).toContain(cs.data.staleSentenceBy.profile);
    const row = await world.ports.planner.getProfile();
    expect([row.bio, row.display_name]).toEqual(['Změněno jinde', 'Mullny Photos']);
    // "Načíst znovu" drops the draft and starts the form again from the fresh row; a new save then works.
    await user.click(within(notice).getByRole('button', { name: cs.data.reload }));
    await waitFor(() => expect((field(t.bio) as HTMLTextAreaElement).value).toBe('Změněno jinde'));
    expect((field(t.name) as HTMLInputElement).value).toBe('Mullny Photos');
    expect(within(screen.getByRole('dialog', { name: t.title })).queryByRole('alert')).toBeNull();
    await change(user, t.name, 'Moje změna');
    await user.click(save(screen.getByRole('dialog', { name: t.title })));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: t.title })).toBeNull());
    expect((await world.ports.planner.getProfile()).display_name).toBe('Moje změna');
    expect(document.activeElement).toBe(editButton());
  });

  it('shows another failure as an error notice and stays open', async () => {
    const world = seeded();
    mount(world);
    const user = userEvent.setup();
    const dialog = await open(user);
    world.failNext('planner.updateProfile', 'network', 1);
    await user.click(save(dialog));
    expect((await within(dialog).findByRole('alert')).textContent).toBeTruthy();
    expect(screen.getByRole('dialog', { name: t.title })).toBeTruthy();
  });
});

describe('Upravit profil dialog: avatar', () => {
  async function chooseFirstPhoto(user: User) {
    await user.click(screen.getByRole('button', { name: t.choosePhoto }));
    const picker = await screen.findByRole('dialog', { name: t.photoPickerTitle });
    await waitFor(() => expect(within(picker).queryAllByRole('radio').length).toBeGreaterThan(1));
    return picker;
  }

  it('chooses one photo with the album-then-photo picker (single choice, a new pick replaces the old one), previews it as a circle, and shows it in the header after the save', async () => {
    const world = seeded();
    mount(world);
    const user = userEvent.setup();
    const dialog = await open(user);
    expect(dialog.querySelector('.ig-avatar-initials')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: t.removePhoto }).hasAttribute('disabled')).toBe(true);
    const picker = await chooseFirstPhoto(user);
    expect(within(picker).queryAllByRole('checkbox')).toHaveLength(0);
    expect(within(picker).getByRole('combobox', { name: cs.instagram.picker.albumLabel })).toBeTruthy();
    const radios = within(picker).getAllByRole('radio') as HTMLInputElement[];
    await user.click(radios[0]!);
    await user.click(radios[1]!);
    expect(radios.map((r) => r.checked)).toEqual(radios.map((_, i) => i === 1));
    expect(picker.textContent).not.toMatch(/Vybráno \d+ z/);
    await user.click(within(picker).getByRole('button', { name: cs.instagram.picker.confirm }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: t.photoPickerTitle })).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: t.choosePhoto }));
    const preview = dialog.querySelector<HTMLImageElement>('img.ig-avatar')!;
    expect(preview.getAttribute('alt')).toBe('');
    expect(preview.getAttribute('src')).toMatch(/^https:\/\/img\.example\.test\/photos\/[0-9a-f-]+\/480\.webp$/);
    expect(dialog.querySelector('.ig-avatar-initials')).toBeNull();
    expect((await world.ports.planner.getProfile()).avatar_photo_id).toBeNull();
    await user.click(save(dialog));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: t.title })).toBeNull());
    const frame = screen.getByRole('region', { name: cs.instagram.profile.label });
    await waitFor(() => expect(frame.querySelector('img.ig-avatar')).toBeTruthy());
    const stored = (await world.ports.planner.getProfile()).avatar_photo_id;
    expect(stored).toMatch(/^[0-9a-f-]{36}$/);
    expect(frame.querySelector('img.ig-avatar')!.getAttribute('src')).toContain(`/photos/${stored}/480.webp`);
    expect(frame.querySelector('.ig-avatar-initials')).toBeNull();
  });

  it('preselects the current photo in the picker, "Odebrat fotku" clears it (focus to "Vybrat fotku") and the header falls back to initials', async () => {
    const world = seeded();
    const id = photoIdOf(world);
    await world.ports.planner.updateProfile({ avatar_photo_id: id });
    mount(world);
    const user = userEvent.setup();
    const dialog = await open(user);
    expect(dialog.querySelector('img.ig-avatar')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: t.removePhoto }));
    expect(dialog.querySelector('img.ig-avatar')).toBeNull();
    expect(dialog.querySelector('.ig-avatar-initials')).toBeTruthy();
    expect(within(dialog).getByText(t.noPhoto)).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: t.choosePhoto }));
    expect(within(dialog).getByRole('button', { name: t.removePhoto }).hasAttribute('disabled')).toBe(true);
    await user.click(save(dialog));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: t.title })).toBeNull());
    expect((await world.ports.planner.getProfile()).avatar_photo_id).toBeNull();
    const frame = screen.getByRole('region', { name: cs.instagram.profile.label });
    await waitFor(() => expect(frame.querySelector('.ig-avatar-initials')).toBeTruthy());
    expect(frame.querySelector('img.ig-avatar')).toBeNull();
  });

  it('cancelling the picker keeps the avatar and Escape in the picker leaves the profile dialog open', async () => {
    const world = seeded();
    await world.ports.planner.updateProfile({ avatar_photo_id: photoIdOf(world) });
    mount(world);
    const user = userEvent.setup();
    const dialog = await open(user);
    const picker = await chooseFirstPhoto(user);
    expect(picker).toBeTruthy();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: t.photoPickerTitle })).toBeNull());
    expect(screen.getByRole('dialog', { name: t.title })).toBe(dialog);
    expect(dialog.querySelector('img.ig-avatar')).toBeTruthy();
  });
});

describe('Upravit profil dialog: accessibility', () => {
  it('axe: no serious or critical violation in the dialog (with an error shown) and in the picker', async () => {
    mount(seeded());
    const user = userEvent.setup();
    const dialog = await open(user);
    fireEvent.change(field(t.link), { target: { value: 'nope' } });
    await user.click(save(dialog));
    await within(dialog).findByText(t.linkInvalid);
    expect(await seriousViolations()).toEqual([]);
    fireEvent.change(field(t.link), { target: { value: '' } });
    await user.click(screen.getByRole('button', { name: t.choosePhoto }));
    const picker = await screen.findByRole('dialog', { name: t.photoPickerTitle });
    await waitFor(() => expect(within(picker).queryAllByRole('radio').length).toBeGreaterThan(0));
    expect(await seriousViolations()).toEqual([]);
  });
});
