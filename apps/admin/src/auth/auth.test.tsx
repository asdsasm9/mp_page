import axe from 'axe-core';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FAKE_ADMIN, FAKE_OUTSIDER, createFakeWorld, fixtureSnapshot, type FakeWorld } from '../adapters/fake';
import { App } from '../App';
import { AppProviders } from '../AppProviders';
import { useAlbum, useUpdateAlbum } from '../data/catalog';
import { cs, glossary } from '../i18n/cs';
import { ApiError, AuthError, type Ports } from '../ports';
import { useSession } from './session';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Where() {
  const { pathname } = useLocation();
  return <output data-testid="where">{pathname}</output>;
}

function setup(path: string, options: { signedIn?: boolean; world?: FakeWorld; ports?: Ports } = {}) {
  const world = options.world ?? createFakeWorld({ signedIn: options.signedIn ?? false });
  const view = render(
    <AppProviders ports={options.ports ?? world.ports} retry={false}>
      <MemoryRouter initialEntries={[path]}>
        <App />
        <Where />
      </MemoryRouter>
    </AppProviders>,
  );
  return { world, ...view };
}

const where = () => screen.getByTestId('where').textContent;
const email = () => screen.getByLabelText(glossary.email) as HTMLInputElement;
const password = () => screen.getByLabelText(glossary.password) as HTMLInputElement;

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>, mail: string, pw: string) {
  await user.clear(email());
  await user.type(email(), mail);
  await user.type(password(), pw);
  await user.click(screen.getByRole('button', { name: glossary.logIn }));
}

describe('route guard', () => {
  it('sends an unauthenticated visitor to /prihlaseni and makes zero data calls', async () => {
    const world = createFakeWorld({ seed: fixtureSnapshot() });
    const { catalog, api } = world.ports;
    const spies = [
      ...Object.keys(catalog).map((k) => vi.spyOn(catalog, k as keyof typeof catalog)),
      ...Object.keys(api).map((k) => vi.spyOn(api, k as keyof typeof api)),
    ];
    setup('/ulozeni', { world });
    await screen.findByRole('heading', { level: 1, name: cs.routes.login.title });
    expect(where()).toBe('/prihlaseni');
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('lets a signed-in admin straight through', async () => {
    setup('/ulozeni', { signedIn: true });
    await screen.findByRole('heading', { level: 1, name: cs.routes.storage.title });
    expect(where()).toBe('/ulozeni');
  });

  it('a signed-in visitor on the login page is sent on to the start page', async () => {
    setup('/prihlaseni', { signedIn: true });
    await screen.findByRole('heading', { level: 1, name: cs.routes.categories.title });
    expect(where()).toBe('/');
  });

  it('shows a retry block when the account check cannot be made', async () => {
    const world = createFakeWorld({ signedIn: true });
    world.failNext('auth.isAdmin', 'network');
    const user = userEvent.setup();
    setup('/', { world });
    await screen.findByText(cs.session.checkFailed);
    await user.click(screen.getByRole('button', { name: glossary.retry }));
    await screen.findByRole('heading', { level: 1, name: cs.routes.categories.title });
  });
});

describe('login screen', () => {
  it('has the fields, attributes and no registration', async () => {
    setup('/prihlaseni');
    await screen.findByRole('heading', { level: 1, name: cs.routes.login.title });
    expect(email().type).toBe('email');
    expect(email().autocomplete).toBe('username');
    expect(password().autocomplete).toBe('current-password');
    expect(password().type).toBe('password');
    expect(screen.getByRole('button', { name: glossary.logIn })).toBeTruthy();
    expect(screen.getByRole('button', { name: glossary.forgotPassword })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Registr|Vytvořit účet/i);
  });

  it('the show-password toggle has an accessible name and reveals the value', async () => {
    const user = userEvent.setup();
    setup('/prihlaseni');
    await screen.findByLabelText(glossary.password);
    await user.type(password(), 'tajne-heslo');
    await user.click(screen.getByRole('button', { name: cs.login.showPassword }));
    expect(password().type).toBe('text');
    expect(password().value).toBe('tajne-heslo');
    await user.click(screen.getByRole('button', { name: cs.login.hidePassword }));
    expect(password().type).toBe('password');
  });

  it('empty fields give field errors and move focus to the first one', async () => {
    const user = userEvent.setup();
    setup('/prihlaseni');
    await screen.findByLabelText(glossary.password);
    await user.click(screen.getByRole('button', { name: glossary.logIn }));
    expect(screen.getByText(cs.login.emailRequired)).toBeTruthy();
    expect(document.activeElement).toBe(email());
    expect(email().getAttribute('aria-invalid')).toBe('true');
    await user.type(email(), FAKE_ADMIN.email);
    await user.click(screen.getByRole('button', { name: glossary.logIn }));
    expect(screen.getByText(cs.login.passwordRequired)).toBeTruthy();
    expect(document.activeElement).toBe(password());
  });

  it('wrong credentials: exact text in an alert, password cleared', async () => {
    const user = userEvent.setup();
    setup('/prihlaseni');
    await screen.findByLabelText(glossary.password);
    await fillAndSubmit(user, FAKE_ADMIN.email, 'spatne');
    expect((await screen.findByRole('alert')).textContent).toBe('Nesprávný e-mail nebo heslo.');
    expect(password().value).toBe('');
    expect(where()).toBe('/prihlaseni');
  });

  it('too many attempts and offline have their own texts', async () => {
    const user = userEvent.setup();
    const { world } = setup('/prihlaseni');
    await screen.findByLabelText(glossary.password);
    world.failNext('auth.signIn', new AuthError('TOO_MANY_ATTEMPTS'));
    await fillAndSubmit(user, FAKE_ADMIN.email, 'x');
    expect((await screen.findByRole('alert')).textContent).toBe('Příliš mnoho pokusů, zkuste to za chvíli.');
    world.failNext('auth.signIn', 'network');
    await user.type(password(), 'x');
    await user.click(screen.getByRole('button', { name: glossary.logIn }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Chybí připojení k internetu.'));
  });

  it('shows "Přihlašuji…" and disables the button while signing in', async () => {
    const user = userEvent.setup();
    const world = createFakeWorld();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ports: Ports = {
      ...world.ports,
      auth: {
        ...world.ports.auth,
        signIn: async (mail, pw) => {
          await gate;
          return world.ports.auth.signIn(mail, pw);
        },
      },
    };
    setup('/prihlaseni', { world, ports });
    await screen.findByLabelText(glossary.password);
    await fillAndSubmit(user, FAKE_ADMIN.email, FAKE_ADMIN.password);
    const busy = await screen.findByRole('button', { name: cs.login.submitting });
    // aria-disabled, not disabled: the button keeps keyboard focus while it works.
    expect(busy.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(busy);
    release();
    await screen.findByRole('heading', { level: 1, name: cs.routes.categories.title });
  });

  it('signs in and returns to the page the guard turned away', async () => {
    const user = userEvent.setup();
    setup('/zverejnit');
    await screen.findByLabelText(glossary.password);
    expect(where()).toBe('/prihlaseni');
    await fillAndSubmit(user, FAKE_ADMIN.email, FAKE_ADMIN.password);
    await screen.findByRole('heading', { level: 1, name: cs.routes.publish.title });
    expect(where()).toBe('/zverejnit');
  });

  it('an account that is not an admin sees the exact text and is signed out again', async () => {
    const user = userEvent.setup();
    const { world } = setup('/prihlaseni');
    await screen.findByLabelText(glossary.password);
    await fillAndSubmit(user, FAKE_OUTSIDER.email, FAKE_OUTSIDER.password);
    expect((await screen.findByRole('alert')).textContent).toBe('Tento účet nemá přístup do správy.');
    expect(world.snapshot().signedInAs).toBeNull();
    expect(where()).toBe('/prihlaseni');
  });

  it('a stored non-admin session is refused at start-up', async () => {
    const world = createFakeWorld();
    await world.ports.auth.signIn(FAKE_OUTSIDER.email, FAKE_OUTSIDER.password);
    setup('/', { world });
    expect((await screen.findByRole('alert')).textContent).toBe('Tento účet nemá přístup do správy.');
    expect(world.snapshot().signedInAs).toBeNull();
  });

  it('has no serious axe violations in the login states', async () => {
    const user = userEvent.setup();
    const { container } = setup('/prihlaseni');
    await screen.findByLabelText(glossary.password);
    const run = async () => {
      const result = await axe.run(container, {
        runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
        rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
      });
      return result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id);
    };
    expect(await run()).toEqual([]);
    await user.click(screen.getByRole('button', { name: glossary.logIn }));
    expect(await run()).toEqual([]);
    await user.click(screen.getByRole('button', { name: glossary.forgotPassword }));
    expect(await run()).toEqual([]);
  });
});

describe('forgot password', () => {
  it('answers with the same neutral text for a known and an unknown address', async () => {
    const user = userEvent.setup();
    setup('/prihlaseni');
    await screen.findByLabelText(glossary.password);
    await user.click(screen.getByRole('button', { name: glossary.forgotPassword }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(cs.login.forgot.title);
    const texts: string[] = [];
    for (const address of [FAKE_ADMIN.email, 'nikdo@example.test']) {
      await user.clear(email());
      await user.type(email(), address);
      await user.click(screen.getByRole('button', { name: cs.login.forgot.submit }));
      const status = await screen.findByText(cs.login.forgot.neutral);
      texts.push(status.textContent ?? '');
      expect(status.closest('[role="status"]')).toBeTruthy();
    }
    expect(texts[0]).toBe(texts[1]);
    expect(texts[0]).not.toContain(FAKE_ADMIN.email);
  });

  it('asks for an address first, reports a lost connection, and goes back', async () => {
    const user = userEvent.setup();
    const { world } = setup('/prihlaseni');
    await screen.findByLabelText(glossary.password);
    await user.click(screen.getByRole('button', { name: glossary.forgotPassword }));
    await user.click(screen.getByRole('button', { name: cs.login.forgot.submit }));
    expect(screen.getByText(cs.login.emailRequired)).toBeTruthy();
    expect(document.activeElement).toBe(email());
    world.failNext('auth.requestPasswordReset', 'network');
    await user.type(email(), 'a@b.cz');
    await user.click(screen.getByRole('button', { name: cs.login.forgot.submit }));
    expect((await screen.findByRole('alert')).textContent).toBe('Chybí připojení k internetu.');
    await user.click(screen.getByRole('button', { name: cs.login.forgot.back }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(cs.routes.login.title);
  });
});

describe('set new password', () => {
  it('shows the new-password form after the reset link and signs in with the new password', async () => {
    const user = userEvent.setup();
    const world = createFakeWorld();
    world.startPasswordRecovery(FAKE_ADMIN.email);
    setup('/prihlaseni', { world });
    await screen.findByRole('heading', { level: 1, name: cs.login.recovery.title });
    const first = screen.getByLabelText(cs.login.recovery.newPassword) as HTMLInputElement;
    const second = screen.getByLabelText(cs.login.recovery.repeat) as HTMLInputElement;
    expect(first.autocomplete).toBe('new-password');
    expect(second.autocomplete).toBe('new-password');

    await user.type(first, 'kratke');
    await user.click(screen.getByRole('button', { name: cs.login.recovery.submit }));
    expect(screen.getByText(cs.login.recovery.tooShort)).toBeTruthy();
    expect(document.activeElement).toBe(first);

    await user.clear(first);
    await user.type(first, 'nove-heslo-123');
    await user.type(second, 'nove-heslo-124');
    await user.click(screen.getByRole('button', { name: cs.login.recovery.submit }));
    expect(screen.getByText(cs.login.recovery.mismatch)).toBeTruthy();

    await user.clear(second);
    await user.type(second, 'nove-heslo-123');
    await user.click(screen.getByRole('button', { name: cs.login.recovery.submit }));
    await screen.findByRole('heading', { level: 1, name: cs.routes.categories.title });
    await world.ports.auth.signOut();
    await expect(world.ports.auth.signIn(FAKE_ADMIN.email, 'nove-heslo-123')).resolves.toMatchObject({ email: FAKE_ADMIN.email });
  });

  it('the guard keeps a recovery session out of the app until the password is set', async () => {
    const world = createFakeWorld();
    world.startPasswordRecovery(FAKE_ADMIN.email);
    setup('/ulozeni', { world });
    await screen.findByRole('heading', { level: 1, name: cs.login.recovery.title });
    expect(where()).toBe('/prihlaseni');
  });
});

describe('sign-out', () => {
  it('the shell button signs out and returns to the login page', async () => {
    const user = userEvent.setup();
    const { world } = setup('/', { signedIn: true });
    await screen.findByRole('heading', { level: 1, name: cs.routes.categories.title });
    await user.click(screen.getByRole('button', { name: glossary.logOut }));
    await screen.findByRole('heading', { level: 1, name: cs.routes.login.title });
    expect(where()).toBe('/prihlaseni');
    expect(world.snapshot().signedInAs).toBeNull();
  });
});

/** A stand-in screen: a form with unsaved text and a save through the data layer. */
function Editor({ albumId }: { albumId: string }) {
  const album = useAlbum(albumId);
  const update = useUpdateAlbum();
  const { status } = useSession();
  const [draft, setDraft] = useState('');
  if (!album.data) return <p>{status}</p>;
  return (
    <div>
      <label htmlFor="title">Titulek</label>
      <input id="title" value={draft} onChange={(e) => setDraft(e.target.value)} />
      <button
        type="button"
        onClick={() => update.mutate({ id: albumId, patch: { title: draft }, options: { expectedUpdatedAt: album.data!.updated_at } })}
      >
        Ulozit titulek
      </button>
      {update.isSuccess ? <p>Ulozeno</p> : null}
    </div>
  );
}

function editorWorld() {
  const world = createFakeWorld({ signedIn: true, seed: fixtureSnapshot() });
  const albumId = (world.snapshot().albums[0] as { id: string }).id;
  return { world, albumId };
}

describe('expiry modal', () => {
  it('keeps the form, and after login the pending save completes', async () => {
    const user = userEvent.setup();
    const { world, albumId } = editorWorld();
    render(
      <AppProviders ports={world.ports} retry={false}>
        <MemoryRouter>
          <Editor albumId={albumId} />
        </MemoryRouter>
      </AppProviders>,
    );
    const field = (await screen.findByLabelText('Titulek')) as HTMLInputElement;
    await user.type(field, 'Nový název');

    world.expireSession();
    const dialog = await screen.findByRole('dialog', { name: cs.login.expired.title });
    expect(within(dialog).getByText(cs.login.expired.body)).toBeTruthy();
    expect((screen.getByLabelText('Titulek') as HTMLInputElement).value).toBe('Nový název');
    expect(document.activeElement).toBe(within(dialog).getByLabelText(glossary.password));

    // Save while expired: it waits instead of failing.
    await user.click(screen.getByRole('button', { name: 'Ulozit titulek' }));
    expect(screen.queryByText('Ulozeno')).toBeNull();
    expect((world.snapshot().albums[0] as { title: string }).title).not.toBe('Nový název');

    const mail = within(dialog).getByLabelText(glossary.email) as HTMLInputElement;
    expect(mail.value).toBe(FAKE_ADMIN.email);
    await user.type(within(dialog).getByLabelText(glossary.password), FAKE_ADMIN.password);
    await user.click(within(dialog).getByRole('button', { name: glossary.logIn }));

    await screen.findByText('Ulozeno');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect((world.snapshot().albums.find((a) => (a as { id: string }).id === albumId) as { title: string }).title).toBe('Nový název');
    expect((screen.getByLabelText('Titulek') as HTMLInputElement).value).toBe('Nový název');
  });

  it('a 401 on a call opens the modal and the call is repeated after login', async () => {
    const user = userEvent.setup();
    const { world, albumId } = editorWorld();
    render(
      <AppProviders ports={world.ports} retry={false}>
        <MemoryRouter>
          <Editor albumId={albumId} />
        </MemoryRouter>
      </AppProviders>,
    );
    await user.type(await screen.findByLabelText('Titulek'), 'Druhý');
    world.failNext('catalog.updateAlbum', new ApiError('UNAUTHENTICATED'));
    await user.click(screen.getByRole('button', { name: 'Ulozit titulek' }));
    const dialog = await screen.findByRole('dialog', { name: cs.login.expired.title });
    await user.type(within(dialog).getByLabelText(glossary.password), FAKE_ADMIN.password);
    await user.click(within(dialog).getByRole('button', { name: glossary.logIn }));
    await screen.findByText('Ulozeno');
  });

  it('a wrong password in the modal keeps it open and the save waiting', async () => {
    const user = userEvent.setup();
    const { world, albumId } = editorWorld();
    render(
      <AppProviders ports={world.ports} retry={false}>
        <MemoryRouter>
          <Editor albumId={albumId} />
        </MemoryRouter>
      </AppProviders>,
    );
    await user.type(await screen.findByLabelText('Titulek'), 'Třetí');
    world.expireSession();
    const dialog = await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: 'Ulozit titulek' }));
    await user.type(within(dialog).getByLabelText(glossary.password), 'spatne');
    await user.click(within(dialog).getByRole('button', { name: glossary.logIn }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe('Nesprávný e-mail nebo heslo.');
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.queryByText('Ulozeno')).toBeNull();
  });

  it('signing out from the modal ends the session and the waiting save is dropped', async () => {
    const user = userEvent.setup();
    const { world, albumId } = editorWorld();
    render(
      <AppProviders ports={world.ports} retry={false}>
        <MemoryRouter>
          <Editor albumId={albumId} />
        </MemoryRouter>
      </AppProviders>,
    );
    await user.type(await screen.findByLabelText('Titulek'), 'Čtvrtý');
    world.expireSession();
    const dialog = await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: 'Ulozit titulek' }));
    await user.click(within(dialog).getByRole('button', { name: glossary.logOut }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByText('Ulozeno')).toBeNull();
    expect((world.snapshot().albums.find((a) => (a as { id: string }).id === albumId) as { title: string }).title).not.toBe('Čtvrtý');
  });

  it('the modal has no serious axe violations', async () => {
    const { world } = editorWorld();
    const { container } = setup('/', { world });
    await screen.findByRole('heading', { level: 1, name: cs.routes.categories.title });
    world.expireSession();
    await screen.findByRole('dialog');
    const result = await axe.run(container, {
      runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
      rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
    });
    expect(result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
  });
});

describe('console', () => {
  it('login, expiry and sign-out write nothing to the console', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m));
    const user = userEvent.setup();
    const { world } = setup('/', { signedIn: false });
    await screen.findByLabelText(glossary.password);
    await fillAndSubmit(user, FAKE_ADMIN.email, FAKE_ADMIN.password);
    await screen.findByRole('heading', { level: 1, name: cs.routes.categories.title });
    world.expireSession();
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(glossary.password), FAKE_ADMIN.password);
    await user.click(within(dialog).getByRole('button', { name: glossary.logIn }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(screen.getByRole('button', { name: glossary.logOut }));
    await screen.findByLabelText(glossary.password);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
