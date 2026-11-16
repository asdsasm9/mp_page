/**
 * "Upravit profil" dialog (WP-15 step 9, T-364): fields and limits with Czech messages, the bio counter, the explicit save with the
 * updated_at precondition, the stale notice with "Načíst znovu", the avatar picker in single-choice mode with "Odebrat fotku",
 * focus back on the opening button, the disabled button when the profile could not be loaded, and the avatar in the header after the save.
 */
import { igAvatarKey } from '@mp/shared';
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeWorld, fixtureSnapshot, type FakeWorld, type ManualClock } from '../adapters/fake';
import { seriousViolations } from '../a11y/helpers';
import { App } from '../App';
import { AppProviders } from '../AppProviders';
import { AvatarCropError, type CropAvatar } from '../encode/cropSquare';
import { cs, glossary } from '../i18n/cs';
import { messageForCode } from '../i18n/messages';

configure({ getElementError: (message) => new Error(message ?? '') });

// jsdom has no object URLs: count them so the tests can see that previews are revoked.
const realCreate = URL.createObjectURL;
const realRevoke = URL.revokeObjectURL;
let created: string[] = [];
let revoked: string[] = [];
beforeEach(() => {
  created = [];
  revoked = [];
  URL.createObjectURL = () => {
    const url = `blob:preview-${created.length + 1}`;
    created.push(url);
    return url;
  };
  URL.revokeObjectURL = (url: string) => void revoked.push(url);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  URL.createObjectURL = realCreate;
  URL.revokeObjectURL = realRevoke;
});

const t = cs.instagram.profile.dialog;
const seeded = () => createFakeWorld({ signedIn: true, seed: fixtureSnapshot(), plannerSeed: true });

const SAVED_KEY = igAvatarKey('dddddddd-0000-4000-8000-0000000000c1');
const advance =(world: FakeWorld, ms: number) => (world.clock as ManualClock).advance(ms);

/** jsdom has no canvas: the stub "crops" to a small WebP blob. */
const cropStub: CropAvatar = async () => new Blob([new Uint8Array(2000)], { type: 'image/webp' });

function mount(world: FakeWorld, cropAvatar: CropAvatar = cropStub) {
  return render(
    <AppProviders
      ports={world.ports}
      retry={false}
      imgBaseUrl="https://img.example.test"
      siteUrl="https://site.example.test"
      cropAvatar={cropAvatar}
    >
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
  const fileInput = () => screen.getByTestId('avatar-file') as HTMLInputElement;
  const picture = (name = 'ja.png', type = 'image/png') => new File([new Uint8Array(64)], name, { type });
  const avatarObjects = (world: FakeWorld) => world.snapshot().objects.filter((o) => o.key.startsWith('ig/avatar/'));

  it('has a "Nahrát fotku" button that opens a hidden file input for JPEG, PNG and WebP', async () => {
    mount(seeded());
    const user = userEvent.setup();
    const dialog = await open(user);
    const click = vi.spyOn(fileInput(), 'click');
    await user.click(within(dialog).getByRole('button', { name: t.choosePhoto }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(fileInput().hidden).toBe(true);
    expect(fileInput().accept).toBe('image/jpeg,image/png,image/webp');
    expect(within(dialog).queryByRole('dialog')).toBeNull();
  });

  it('crops, previews as a round picture, uploads on its own and saves avatar_key; the header shows it and cleanup runs', async () => {
    const world = seeded();
    const cleanupSpy = vi.spyOn(world.ports.api, 'cleanupIgAvatars');
    const crop = vi.fn(cropStub);
    mount(world, crop);
    const user = userEvent.setup();
    const dialog = await open(user);
    expect(dialog.querySelector('.ig-avatar-initials')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: t.removePhoto }).hasAttribute('disabled')).toBe(true);
    const file = picture();
    await user.upload(fileInput(), file);
    expect(crop).toHaveBeenCalledWith(file);
    expect(await within(dialog).findByText(t.uploaded)).toBeTruthy();
    const preview = dialog.querySelector<HTMLImageElement>('img.ig-avatar')!;
    expect(preview.getAttribute('src')).toBe('blob:preview-1');
    expect(preview.getAttribute('alt')).toBe('');
    expect(dialog.querySelector('.ig-avatar-initials')).toBeNull();
    expect(avatarObjects(world)).toHaveLength(1);
    expect((await world.ports.planner.getProfile()).avatar_key).toBeNull();
    expect(save(dialog).hasAttribute('disabled')).toBe(false);
    await user.click(save(dialog));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: t.title })).toBeNull());
    const stored = (await world.ports.planner.getProfile()).avatar_key;
    expect(stored).toMatch(/^ig\/avatar\/[0-9a-f-]{36}\.webp$/);
    expect(avatarObjects(world).map((o) => o.key)).toEqual([stored]);
    const frame = screen.getByRole('region', { name: cs.instagram.profile.label });
    await waitFor(() => expect(frame.querySelector('img.ig-avatar')).toBeTruthy());
    expect(frame.querySelector('img.ig-avatar')!.getAttribute('src')).toBe(`https://img.example.test/${stored}`);
    expect(frame.querySelector('.ig-avatar-initials')).toBeNull();
    expect(cleanupSpy).toHaveBeenCalledTimes(1);
    expect(revoked).toEqual(created); // the preview is released when the dialog closes
  });

  it('a second pick replaces the first and revokes its preview; Save keeps the newer key', async () => {
    const world = seeded();
    mount(world);
    const user = userEvent.setup();
    const dialog = await open(user);
    await user.upload(fileInput(), picture('a.png'));
    await within(dialog).findByText(t.uploaded);
    await user.upload(fileInput(), picture('b.png'));
    await waitFor(() => expect(created).toHaveLength(2));
    await waitFor(() => expect(avatarObjects(world)).toHaveLength(2));
    expect(revoked).toEqual(['blob:preview-1']);
    expect(dialog.querySelector('img.ig-avatar')!.getAttribute('src')).toBe('blob:preview-2');
    await user.click(save(dialog));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: t.title })).toBeNull());
    const stored = (await world.ports.planner.getProfile()).avatar_key!;
    expect(avatarObjects(world).map((o) => o.key)).toContain(stored);
  });

  it('shows the picked file as preparing, then uploading with a progress bar, and keeps Uložit disabled until it is done', async () => {
    const world = seeded();
    world.slowPut(1000);
    const spy = vi.spyOn(world.ports.planner, 'updateProfile');
    let release: (blob: Blob) => void = () => {};
    mount(world, () => new Promise<Blob>((resolve) => (release = resolve)));
    const user = userEvent.setup();
    const dialog = await open(user);
    await user.upload(fileInput(), picture());
    expect((await within(dialog).findByText(t.preparing)).getAttribute('role')).toBe('status');
    expect(save(dialog).hasAttribute('disabled')).toBe(true);
    release(new Blob([new Uint8Array(2000)], { type: 'image/webp' }));
    const bar = await within(dialog).findByRole('progressbar', { name: t.uploading });
    expect(bar.getAttribute('max')).toBe('100');
    expect(bar.getAttribute('value')).toBe('0');
    expect(save(dialog).hasAttribute('disabled')).toBe(true);
    await user.click(save(dialog));
    fireEvent.submit(dialog.querySelector('form')!);
    expect(spy).not.toHaveBeenCalled();
    await act(() => advance(world, 1000));
    expect(await within(dialog).findByText(t.uploaded)).toBeTruthy();
    expect(within(dialog).queryByRole('progressbar')).toBeNull();
    expect(save(dialog).hasAttribute('disabled')).toBe(false);
  });

  it('shows an upload error in an alert without changing the avatar, and picking again retries', async () => {
    const world = seeded();
    mount(world);
    const user = userEvent.setup();
    const dialog = await open(user);
    world.failNext('upload.put', 'network', 1);
    await user.upload(fileInput(), picture());
    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toBe(messageForCode('NETWORK'));
    expect(dialog.querySelector('.ig-avatar-initials')).toBeTruthy();
    expect(created).toEqual(revoked);
    expect(save(dialog).hasAttribute('disabled')).toBe(false);
    expect(within(dialog).getByRole('button', { name: t.choosePhoto }).getAttribute('aria-describedby')).toBe(alert.id);
    await user.upload(fileInput(), picture());
    expect(await within(dialog).findByText(t.uploaded)).toBeTruthy();
    expect(within(dialog).queryByRole('alert')).toBeNull();
    await user.click(save(dialog));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: t.title })).toBeNull());
    expect((await world.ports.planner.getProfile()).avatar_key).toMatch(/^ig\/avatar\//);
  });

  it('shows the Czech message of a failed crop, and of a reserve refused by the Worker', async () => {
    const world = seeded();
    const crop = vi.fn<CropAvatar>(async () => {
      throw new AvatarCropError('DECODE_FAILED');
    });
    mount(world, crop);
    const user = userEvent.setup();
    const dialog = await open(user);
    await user.upload(fileInput(), picture());
    expect((await within(dialog).findByRole('alert')).textContent).toBe(t.cropDecodeFailed);
    crop.mockImplementation(cropStub);
    world.failNext('api.reserveIgAvatar', 'network', 1);
    await user.upload(fileInput(), picture());
    await waitFor(() => expect(within(dialog).getByRole('alert').textContent).toBe(messageForCode('NETWORK')));
    expect(avatarObjects(world)).toHaveLength(0);
  });

  it('refuses a file over 25 MB with the Czech message, before cropping', async () => {
    const world = seeded();
    const crop = vi.fn(cropStub);
    mount(world, crop);
    const user = userEvent.setup();
    const dialog = await open(user);
    const big = picture();
    Object.defineProperty(big, 'size', { value: 25 * 1024 * 1024 + 1 });
    await user.upload(fileInput(), big);
    expect((await within(dialog).findByRole('alert')).textContent).toBe(t.inputTooLarge);
    expect(crop).not.toHaveBeenCalled();
    expect(avatarObjects(world)).toHaveLength(0);
    expect(dialog.querySelector('.ig-avatar-initials')).toBeTruthy();
  });

  it('a stale save still works: the notice appears, "Načíst znovu" restarts the form, and a new upload then saves', async () => {
    const world = seeded();
    mount(world);
    const user = userEvent.setup();
    const dialog = await open(user);
    await user.upload(fileInput(), picture());
    await within(dialog).findByText(t.uploaded);
    await world.ports.planner.updateProfile({ bio: 'Změněno jinde' });
    await user.click(save(dialog));
    const notice = await within(dialog).findByRole('alert');
    expect(notice.textContent).toContain(cs.data.staleSentenceBy.profile);
    expect((await world.ports.planner.getProfile()).avatar_key).toBeNull();
    await user.click(within(notice).getByRole('button', { name: cs.data.reload }));
    await waitFor(() => expect((field(t.bio) as HTMLTextAreaElement).value).toBe('Změněno jinde'));
    const again = screen.getByRole('dialog', { name: t.title });
    await user.upload(fileInput(), picture());
    await within(again).findByText(t.uploaded);
    await user.click(save(again));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: t.title })).toBeNull());
    expect((await world.ports.planner.getProfile()).avatar_key).toMatch(/^ig\/avatar\//);
  });

  it('a failing cleanup after the save is swallowed', async () => {
    const world = seeded();
    vi.spyOn(world.ports.api, 'cleanupIgAvatars').mockRejectedValue(new Error('boom'));
    mount(world);
    const user = userEvent.setup();
    const dialog = await open(user);
    await user.upload(fileInput(), picture());
    await within(dialog).findByText(t.uploaded);
    await user.click(save(dialog));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: t.title })).toBeNull());
    expect(await screen.findByText(t.saved)).toBeTruthy();
  });

  it('falls back to initials when the avatar image fails to load', async () => {
    const world = seeded();
    await world.ports.planner.updateProfile({ avatar_key: SAVED_KEY });
    mount(world);
    const user = userEvent.setup();
    const dialog = await open(user);
    const img = dialog.querySelector('img.ig-avatar')!;
    fireEvent.error(img);
    expect(dialog.querySelector('img.ig-avatar')).toBeNull();
    expect(dialog.querySelector('.ig-avatar-initials')).toBeTruthy();
  });

  it('"Odebrat fotku" clears the avatar (focus to "Nahrát fotku"), also an uploaded one, and the header falls back to initials', async () => {
    const world = seeded();
    await world.ports.planner.updateProfile({ avatar_key: SAVED_KEY });
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
    expect((await world.ports.planner.getProfile()).avatar_key).toBeNull();
    const frame = screen.getByRole('region', { name: cs.instagram.profile.label });
    await waitFor(() => expect(frame.querySelector('.ig-avatar-initials')).toBeTruthy());
    expect(frame.querySelector('img.ig-avatar')).toBeNull();
  });

  it('removing during an upload cancels it: the late result does not set the avatar', async () => {
    const world = seeded();
    await world.ports.planner.updateProfile({ avatar_key: SAVED_KEY });
    world.slowPut(1000);
    mount(world);
    const user = userEvent.setup();
    const dialog = await open(user);
    await user.upload(fileInput(), picture());
    await within(dialog).findByRole('progressbar');
    await user.click(within(dialog).getByRole('button', { name: t.removePhoto }));
    expect(within(dialog).queryByRole('progressbar')).toBeNull();
    await act(() => advance(world, 1000));
    expect(dialog.querySelector('.ig-avatar-initials')).toBeTruthy();
    expect(avatarObjects(world)).toHaveLength(0);
    expect(within(dialog).queryByText(t.uploaded)).toBeNull();
  });
});

describe('Upravit profil dialog: accessibility', () => {
  it('axe: no serious or critical violation in the dialog with a field error, an upload in progress, an upload error and a finished upload', async () => {
    const world = seeded();
    mount(world);
    const user = userEvent.setup();
    const dialog = await open(user);
    fireEvent.change(field(t.link), { target: { value: 'nope' } });
    await user.click(save(dialog));
    await within(dialog).findByText(t.linkInvalid);
    expect(await seriousViolations()).toEqual([]);
    fireEvent.change(field(t.link), { target: { value: '' } });
    world.slowPut(1000);
    await user.upload(screen.getByTestId('avatar-file'), new File([new Uint8Array(8)], 'a.png', { type: 'image/png' }));
    await within(dialog).findByRole('progressbar');
    expect(await seriousViolations()).toEqual([]);
    await act(() => advance(world, 1000));
    await within(dialog).findByText(t.uploaded);
    expect(await seriousViolations()).toEqual([]);
    world.slowPut(null);
    world.failNext('upload.put', 'network', 1);
    await user.upload(screen.getByTestId('avatar-file'), new File([new Uint8Array(8)], 'b.png', { type: 'image/png' }));
    await within(dialog).findByRole('alert');
    expect(await seriousViolations()).toEqual([]);
  });
});
