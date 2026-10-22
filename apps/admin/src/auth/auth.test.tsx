import axe from 'axe-core';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FAKE_ADMIN, createFakeWorld, fixtureSnapshot, type FakeWorld } from '../adapters/fake';
import { App } from '../App';
import { AppProviders } from '../AppProviders';
import { useAlbum, useUpdateAlbum } from '../data/catalog';
import { cs, glossary } from '../i18n/cs';
import { ApiError, AuthError, NetworkError, type CallbackError, type GoogleSignInOptions, type Ports } from '../ports';
import { takeReturnPath } from './returnPath';
import { useSession } from './session';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

function Where() {
  const { pathname, search } = useLocation();
  return (
    <>
      <output data-testid="where">{pathname}</output>
      <output data-testid="search">{search}</output>
    </>
  );
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
const search = () => screen.getByTestId('search').textContent;
const googleButton = () => screen.getByRole('button', { name: cs.login.google.button });
const findGoogleButton = () => screen.findByRole('button', { name: cs.login.google.button });

/** Ports whose auth reports a callback error once (what the adapter does after a failed Google round trip). */
function portsWithCallbackError(world: FakeWorld, error: CallbackError): Ports {
  let pending: CallbackError | null = error;
  return {
    ...world.ports,
    auth: {
      ...world.ports.auth,
      takeCallbackError: () => {
        const taken = pending;
        pending = null;
        return taken;
      },
    },
  };
}

/** Ports whose Google sign-in never finishes (the real adapter has left the page) and records its options. */
function portsThatNeverReturn(world: FakeWorld, calls: GoogleSignInOptions[] = []): Ports {
  return {
    ...world.ports,
    auth: {
      ...world.ports.auth,
      signInWithGoogle: (options) => {
        calls.push(options);
        return new Promise<void>(() => undefined);
      },
    },
  };
}

async function axeSerious(container: Element): Promise<string[]> {
  const result = await axe.run(container, {
    runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  });
  return result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id);
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

describe('login screen: the Google card', () => {
  it('has the fields, attributes and no registration: the exact Google card and nothing else to sign in with', async () => {
    setup('/prihlaseni');
    await findGoogleButton();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Přihlášení');
    expect(screen.getByText('Do správy se přihlašujete účtem Google. Přístup mají jen dva povolené účty.')).toBeTruthy();
    expect(googleButton().textContent).toBe('Přihlásit se přes Google');
    expect(screen.getByText('Tip: zapněte si v účtu Google dvoustupňové ověření, správa je pak lépe chráněná.')).toBeTruthy();
    // Only the Google card: no password form, no forgot link, no e-mail field, no registration.
    expect(document.querySelectorAll('input')).toHaveLength(0);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(document.body.textContent).not.toMatch(/Heslo|Zapomenuté|Registr|Vytvořit účet/i);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('focus lands on the Google button', async () => {
    setup('/prihlaseni');
    const button = await findGoogleButton();
    await waitFor(() => expect(document.activeElement).toBe(button));
  });

  it('shows "Ověřuji přihlášení…" while the session is being checked, without the button', async () => {
    const world = createFakeWorld({ signedIn: true });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ports: Ports = {
      ...world.ports,
      auth: {
        ...world.ports.auth,
        getSession: async () => {
          await gate;
          return world.ports.auth.getSession();
        },
      },
    };
    setup('/prihlaseni', { world, ports });
    const status = await screen.findByText('Ověřuji přihlášení…');
    expect(status.getAttribute('role')).toBe('status');
    expect(screen.queryByRole('button', { name: cs.login.google.button })).toBeNull();
    release();
    await screen.findByRole('heading', { level: 1, name: cs.routes.categories.title });
  });

  it('shows "Přesměrovávám na Google…" and ignores clicks while busy, keeping focus on the button', async () => {
    const user = userEvent.setup();
    const calls: GoogleSignInOptions[] = [];
    const world = createFakeWorld();
    setup('/prihlaseni', { world, ports: portsThatNeverReturn(world, calls) });
    await user.click(await findGoogleButton());
    const busy = await screen.findByRole('button', { name: 'Přesměrovávám na Google…' });
    expect(busy.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(busy);
    await user.click(busy);
    expect(calls).toHaveLength(1);
  });

  it('signs in and returns to the page the guard turned away (fake Google chooser)', async () => {
    const user = userEvent.setup();
    setup('/zverejnit');
    await user.click(await findGoogleButton());
    await screen.findByRole('heading', { level: 1, name: cs.routes.publish.title });
    expect(where()).toBe('/zverejnit');
    expect(takeReturnPath()).toBe('/');
  });

  it('stores the page the guard turned away before it leaves for Google', async () => {
    const user = userEvent.setup();
    const calls: GoogleSignInOptions[] = [];
    const world = createFakeWorld();
    setup('/zverejnit?x=1', { world, ports: portsThatNeverReturn(world, calls) });
    await user.click(await findGoogleButton());
    expect(calls).toEqual([{ returnTo: '/zverejnit?x=1' }]);
    expect(takeReturnPath()).toBe('/zverejnit?x=1');
  });

  it('after the redirect back it restores the stored path, then forgets it', async () => {
    sessionStorage.setItem('mp-admin-return-to', '/ulozeni');
    setup('/prihlaseni', { signedIn: true });
    await screen.findByRole('heading', { level: 1, name: cs.routes.storage.title });
    expect(where()).toBe('/ulozeni');
    expect(takeReturnPath()).toBe('/');
  });

  it('never follows a hostile stored path', async () => {
    sessionStorage.setItem('mp-admin-return-to', '//evil.example');
    setup('/prihlaseni', { signedIn: true });
    await screen.findByRole('heading', { level: 1, name: cs.routes.categories.title });
    expect(where()).toBe('/');
  });

  it('an account that is not allowed sees the exact text and is signed out again', async () => {
    const user = userEvent.setup();
    const { world } = setup('/prihlaseni');
    world.google.next = 'outsider';
    await user.click(await findGoogleButton());
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Tento účet Google nemá přístup do správy. Zkuste se přihlásit jiným účtem Google.',
    );
    expect(world.snapshot().signedInAs).toBeNull();
    expect(where()).toBe('/prihlaseni');
    expect(googleButton()).toBeTruthy();
  });

  it('cancelling at Google shows its text', async () => {
    const user = userEvent.setup();
    const { world } = setup('/prihlaseni');
    world.google.next = 'cancel';
    await user.click(await findGoogleButton());
    expect((await screen.findByRole('alert')).textContent).toBe('Přihlášení přes Google bylo zrušeno.');
    expect(document.activeElement).toBe(googleButton());
  });

  it('offline and too many attempts have their own texts', async () => {
    const user = userEvent.setup();
    const world = createFakeWorld();
    let failure: Error = new NetworkError();
    const ports: Ports = {
      ...world.ports,
      auth: {
        ...world.ports.auth,
        signInWithGoogle: async () => {
          throw failure;
        },
      },
    };
    setup('/prihlaseni', { world, ports });
    await user.click(await findGoogleButton());
    expect((await screen.findByRole('alert')).textContent).toBe('Chybí připojení k internetu.');
    failure = new AuthError('TOO_MANY_ATTEMPTS');
    await user.click(googleButton());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Příliš mnoho pokusů, zkuste to za chvíli.'));
    // A new attempt clears the old notice.
    failure = new ApiError('UPSTREAM_ERROR');
    await user.click(googleButton());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(cs.data.unavailable));
  });

  it('a stored non-admin session is refused at start-up with the same text', async () => {
    const world = createFakeWorld();
    world.google.next = 'outsider';
    await world.ports.auth.signInWithGoogle({ returnTo: '/' });
    setup('/', { world });
    expect((await screen.findByRole('alert')).textContent).toBe(cs.login.google.notAllowed);
    expect(world.snapshot().signedInAs).toBeNull();
  });
});

describe('login screen: the callback of the Google round trip', () => {
  it.each([
    ['NOT_ALLOWED', 'Tento účet Google nemá přístup do správy. Zkuste se přihlásit jiným účtem Google.'],
    ['CANCELLED', 'Přihlášení přes Google bylo zrušeno.'],
    ['FAILED', 'Přihlášení přes Google se nepodařilo. Zkuste to znovu.'],
  ] as const)('%s is shown once in an alert', async (code, text) => {
    const world = createFakeWorld();
    setup('/prihlaseni', { world, ports: portsWithCallbackError(world, code) });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(text);
    expect(googleButton()).toBeTruthy();
  });

  it('a failed code exchange leaves ?code= and no session: generic failure text and the URL is cleaned', async () => {
    setup('/prihlaseni?code=abc123&keep=1');
    expect((await screen.findByRole('alert')).textContent).toBe('Přihlášení přes Google se nepodařilo. Zkuste to znovu.');
    await waitFor(() => expect(search()).toBe('?keep=1'));
    expect(where()).toBe('/prihlaseni');
    expect(document.body.textContent).not.toContain('abc123');
  });

  it('a ?code= while the session is still being checked is left alone, and no failure shows on success', async () => {
    setup('/prihlaseni?code=abc123', { signedIn: true });
    await screen.findByRole('heading', { level: 1, name: cs.routes.categories.title });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('login screen: accessibility and console', () => {
  it('has no serious axe violations in any login state', async () => {
    const user = userEvent.setup();
    const { container } = setup('/prihlaseni');
    await findGoogleButton();
    expect(await axeSerious(container)).toEqual([]);
    cleanup();

    // each notice
    for (const code of ['NOT_ALLOWED', 'CANCELLED', 'FAILED'] as const) {
      const world = createFakeWorld();
      const view = setup('/prihlaseni', { world, ports: portsWithCallbackError(world, code) });
      await screen.findByRole('alert');
      expect(await axeSerious(view.container)).toEqual([]);
      cleanup();
    }

    // busy
    const world = createFakeWorld();
    const busy = setup('/prihlaseni', { world, ports: portsThatNeverReturn(world) });
    await user.click(await findGoogleButton());
    await screen.findByRole('button', { name: cs.login.google.busy });
    expect(await axeSerious(busy.container)).toEqual([]);
    cleanup();

    // after return (checking)
    const slow = createFakeWorld({ signedIn: true });
    const checking = setup('/prihlaseni', {
      world: slow,
      ports: { ...slow.ports, auth: { ...slow.ports.auth, getSession: () => new Promise(() => undefined) } },
    });
    await screen.findByText('Ověřuji přihlášení…');
    expect(await axeSerious(checking.container)).toEqual([]);
  });

  it('sign-in, notices and busy state write nothing to the console', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m));
    const user = userEvent.setup();
    const { world } = setup('/prihlaseni');
    world.google.next = 'cancel';
    await user.click(await findGoogleButton());
    await screen.findByRole('alert');
    world.google.next = 'outsider';
    await user.click(googleButton());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(cs.login.google.notAllowed));
    await user.click(googleButton());
    await screen.findByRole('heading', { level: 1, name: cs.routes.categories.title });
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
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

function renderEditor(world: FakeWorld, albumId: string, ports: Ports = world.ports) {
  return render(
    <AppProviders ports={ports} retry={false}>
      <MemoryRouter>
        <Editor albumId={albumId} />
      </MemoryRouter>
    </AppProviders>,
  );
}

describe('expiry modal', () => {
  it('has the exact title and honest body, focus on the Google button, and after login the pending save completes', async () => {
    const user = userEvent.setup();
    const { world, albumId } = editorWorld();
    renderEditor(world, albumId);
    const field = (await screen.findByLabelText('Titulek')) as HTMLInputElement;
    await user.type(field, 'Nový název');

    world.expireSession();
    const dialog = await screen.findByRole('dialog', { name: 'Přihlášení vypršelo' });
    expect(
      within(dialog).getByText(
        'Přihlaste se znovu přes Google. Po přihlášení se stránka načte znovu, neuložené změny a fotky ve frontě se ztratí.',
      ),
    ).toBeTruthy();
    const button = within(dialog).getByRole('button', { name: 'Přihlásit se přes Google' });
    expect(document.activeElement).toBe(button);
    expect(within(dialog).queryByLabelText(/heslo/i)).toBeNull();
    expect((screen.getByLabelText('Titulek') as HTMLInputElement).value).toBe('Nový název');

    // Save while expired: it waits instead of failing.
    await user.click(screen.getByRole('button', { name: 'Ulozit titulek' }));
    expect(screen.queryByText('Ulozeno')).toBeNull();
    expect((world.snapshot().albums[0] as { title: string }).title).not.toBe('Nový název');

    await user.click(button);
    await screen.findByText('Ulozeno');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect((world.snapshot().albums.find((a) => (a as { id: string }).id === albumId) as { title: string }).title).toBe('Nový název');
    expect((screen.getByLabelText('Titulek') as HTMLInputElement).value).toBe('Nový název');
  });

  it('passes the current e-mail as login_hint and the current address as the return path', async () => {
    const user = userEvent.setup();
    const { world, albumId } = editorWorld();
    const calls: GoogleSignInOptions[] = [];
    renderEditor(world, albumId, portsThatNeverReturn(world, calls));
    await screen.findByLabelText('Titulek');
    world.expireSession();
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: cs.login.google.button }));
    expect(calls).toEqual([{ returnTo: '/', loginHint: FAKE_ADMIN.email }]);
    expect(within(dialog).getByRole('button', { name: cs.login.google.busy }).getAttribute('aria-disabled')).toBe('true');
  });

  it('a 401 on a call opens the modal and the call is repeated after login', async () => {
    const user = userEvent.setup();
    const { world, albumId } = editorWorld();
    renderEditor(world, albumId);
    await user.type(await screen.findByLabelText('Titulek'), 'Druhý');
    world.failNext('catalog.updateAlbum', new ApiError('UNAUTHENTICATED'));
    await user.click(screen.getByRole('button', { name: 'Ulozit titulek' }));
    const dialog = await screen.findByRole('dialog', { name: cs.login.expired.title });
    await user.click(within(dialog).getByRole('button', { name: cs.login.google.button }));
    await screen.findByText('Ulozeno');
  });

  it('cancelling at Google keeps the modal open and the save waiting; a non-allowed account is signed out and the save dropped', async () => {
    const user = userEvent.setup();
    const { world, albumId } = editorWorld();
    renderEditor(world, albumId);
    await user.type(await screen.findByLabelText('Titulek'), 'Třetí');
    world.expireSession();
    const dialog = await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: 'Ulozit titulek' }));
    world.google.next = 'cancel';
    await user.click(within(dialog).getByRole('button', { name: cs.login.google.button }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe('Přihlášení přes Google bylo zrušeno.');
    expect(screen.getByRole('dialog')).toBeTruthy();
    world.google.next = 'outsider';
    await user.click(within(dialog).getByRole('button', { name: cs.login.google.button }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByText('Ulozeno')).toBeNull();
    expect(world.snapshot().signedInAs).toBeNull();
  });

  it('Escape does not dismiss it', async () => {
    const user = userEvent.setup();
    const { world, albumId } = editorWorld();
    renderEditor(world, albumId);
    await screen.findByLabelText('Titulek');
    world.expireSession();
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('signing out from the modal ends the session and the waiting save is dropped', async () => {
    const user = userEvent.setup();
    const { world, albumId } = editorWorld();
    renderEditor(world, albumId);
    await user.type(await screen.findByLabelText('Titulek'), 'Čtvrtý');
    world.expireSession();
    const dialog = await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: 'Ulozit titulek' }));
    await user.click(within(dialog).getByRole('button', { name: glossary.logOut }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByText('Ulozeno')).toBeNull();
    expect((world.snapshot().albums.find((a) => (a as { id: string }).id === albumId) as { title: string }).title).not.toBe('Čtvrtý');
  });

  it('the modal has no serious axe violations, also with a notice and while busy', async () => {
    const user = userEvent.setup();
    const { world } = editorWorld();
    const { container } = setup('/', { world });
    await screen.findByRole('heading', { level: 1, name: cs.routes.categories.title });
    world.expireSession();
    const dialog = await screen.findByRole('dialog');
    expect(await axeSerious(container)).toEqual([]);
    world.google.next = 'cancel';
    await user.click(within(dialog).getByRole('button', { name: cs.login.google.button }));
    await within(dialog).findByRole('alert');
    expect(await axeSerious(container)).toEqual([]);
  });

  it('writes nothing to the console through expiry and re-sign-in', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m));
    const user = userEvent.setup();
    const { world } = setup('/', { signedIn: false });
    await user.click(await findGoogleButton());
    await screen.findByRole('heading', { level: 1, name: cs.routes.categories.title });
    world.expireSession();
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: cs.login.google.button }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(screen.getByRole('button', { name: glossary.logOut }));
    await findGoogleButton();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
