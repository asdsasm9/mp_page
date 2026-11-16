/** Share paths of a saved post (WP-14 tests 13 and 15): prepare then share, order, cancel, errors, copy, download. */
import { jpegKey, type IgPost } from '@mp/shared';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { seriousViolations } from '../a11y/helpers';
import { createFakeWorld } from '../adapters/fake';
import { AppProviders } from '../AppProviders';
import { cs } from '../i18n/cs';
import type { ShareDeps } from '../share/shareDeps';
import { jpegUrl } from '../share/shareFiles';
import { SharePanel } from './SharePanel';

afterEach(cleanup);

const t = cs.instagram.share;
const IMG = 'https://img.example.test';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

const post = (photos: IgPost['photos'], over: Partial<IgPost> = {}): IgPost => ({
  id: '99999999-9999-4999-8999-999999999999',
  caption: 'Svatba',
  hashtags: '#love',
  planned_on: null,
  status: 'planned',
  posted_at: null,
  sort: 10,
  created_at: '2026-11-01T10:00:00.000Z',
  updated_at: '2026-11-01T10:00:00.000Z',
  photos,
  ...over,
});
const threePhotos: IgPost['photos'] = [
  { photo_id: B, sort: 2 },
  { photo_id: C, sort: 3 },
  { photo_id: A, sort: 1 },
];

function jpegResponse(type = 'image/jpeg', ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 404,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? type : null) },
    blob: async () => new Blob(['x'], { type }),
  } as unknown as Response;
}

function fakeDeps(over: Partial<ShareDeps> = {}): ShareDeps & { [K in keyof ShareDeps]: ReturnType<typeof vi.fn> } {
  return {
    fetch: vi.fn(async () => jpegResponse()),
    share: vi.fn(async () => undefined),
    canShare: vi.fn(() => true),
    writeText: vi.fn(async () => undefined),
    download: vi.fn(),
    ...over,
  } as never;
}

function mount(deps: ShareDeps, p: IgPost = post(threePhotos), dirty = false) {
  const world = createFakeWorld({ signedIn: true });
  return render(
    <AppProviders ports={world.ports} retry={false} imgBaseUrl={IMG} shareDeps={deps}>
      <MemoryRouter>
        <SharePanel post={p} dirty={dirty} />
      </MemoryRouter>
    </AppProviders>,
  );
}

const button = (name: string) => screen.queryByRole('button', { name });

describe('jpegUrl', () => {
  it('derives the URL from a valid photo id and the image origin only', () => {
    expect(jpegUrl(IMG, A)).toBe(`${IMG}/${jpegKey(A)}`);
    expect(jpegUrl(IMG, '../etc/passwd')).toBeNull();
    expect(jpegUrl(IMG, 'ABCDEF01-1111-4111-8111-111111111111')).toBeNull();
  });
});

describe('SharePanel', () => {
  it('hides the share button when files cannot be shared, but keeps copy and download', async () => {
    const deps = fakeDeps({ canShare: vi.fn(() => false) });
    mount(deps);
    expect(button(t.share)).toBeNull();
    expect(button(t.prepare)).toBeNull();
    expect(button(t.copy)).toBeTruthy();
    expect(button(t.download)).toBeTruthy();
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it('prepares the files in carousel order before the tap, then shares them at once', async () => {
    const deps = fakeDeps();
    mount(deps);
    const share = await screen.findByRole('button', { name: t.share });
    expect(deps.fetch).toHaveBeenCalledTimes(3);
    expect(deps.fetch.mock.calls.map((c) => c[0])).toEqual([jpegUrl(IMG, A), jpegUrl(IMG, B), jpegUrl(IMG, C)]);
    for (const call of deps.fetch.mock.calls) expect(call[1]).toEqual({ credentials: 'omit', mode: 'cors' });
    expect(screen.getByText(t.ready)).toBeTruthy();
    // The tap runs share() without any fetch in between (user activation).
    deps.fetch.mockClear();
    await userEvent.setup().click(share);
    expect(deps.fetch).not.toHaveBeenCalled();
    expect(deps.share).toHaveBeenCalledTimes(1);
    const files = (deps.share.mock.calls[0]![0] as ShareData).files!;
    expect(files.map((f) => f.name)).toEqual(['foto-1.jpg', 'foto-2.jpg', 'foto-3.jpg']);
    expect(files.every((f) => f.type === 'image/jpeg')).toBe(true);
  });

  it('rechecks canShare with the real files and hides the button when they are refused', async () => {
    const canShare = vi.fn((data: ShareData) => (data.files ?? []).length === 1);
    mount(fakeDeps({ canShare }));
    await waitFor(() => expect(canShare.mock.calls.some((c) => (c[0].files ?? []).length === 3)).toBe(true));
    expect(button(t.share)).toBeNull();
  });

  it('treats a cancelled share sheet as neutral', async () => {
    const deps = fakeDeps({ share: vi.fn(async () => Promise.reject(new DOMException('x', 'AbortError'))) });
    mount(deps);
    await userEvent.setup().click(await screen.findByRole('button', { name: t.share }));
    expect(await screen.findByText(t.cancelled)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('asks to tap again after NotAllowedError', async () => {
    const deps = fakeDeps({ share: vi.fn(async () => Promise.reject(new DOMException('x', 'NotAllowedError'))) });
    mount(deps);
    await userEvent.setup().click(await screen.findByRole('button', { name: t.share }));
    expect((await screen.findByRole('alert')).textContent).toBe(t.notAllowed);
  });

  it('names a share failure and points at the download', async () => {
    const deps = fakeDeps({ share: vi.fn(async () => Promise.reject(new Error('boom'))) });
    mount(deps);
    await userEvent.setup().click(await screen.findByRole('button', { name: t.share }));
    expect((await screen.findByRole('alert')).textContent).toBe(t.shareFailed);
  });

  it('reports a fetch failure and lets the person prepare again', async () => {
    const fetchFn = vi.fn<ShareDeps['fetch']>(async () => Promise.reject(new TypeError('offline')));
    const deps = fakeDeps({ fetch: fetchFn });
    mount(deps);
    expect((await screen.findByRole('alert')).textContent).toBe(t.fetchFailed);
    expect(button(t.share)).toBeNull();
    fetchFn.mockImplementation(async () => jpegResponse());
    await userEvent.setup().click(screen.getByRole('button', { name: t.prepare }));
    expect(await screen.findByRole('button', { name: t.share })).toBeTruthy();
  });

  it('rejects an HTTP error and a non-image response', async () => {
    mount(fakeDeps({ fetch: vi.fn(async () => jpegResponse('image/jpeg', false)) }));
    expect((await screen.findByRole('alert')).textContent).toBe(t.fetchFailed);
    cleanup();
    const deps = fakeDeps({ fetch: vi.fn(async () => jpegResponse('text/html')) });
    mount(deps);
    expect((await screen.findByRole('alert')).textContent).toBe(t.fetchFailed);
    expect(button(t.share)).toBeNull();
  });

  it('copies caption and hashtags with a toast', async () => {
    const deps = fakeDeps({ canShare: vi.fn(() => false) });
    mount(deps);
    await userEvent.setup().click(screen.getByRole('button', { name: t.copy }));
    expect(deps.writeText).toHaveBeenCalledWith('Svatba\n\n#love');
    expect(await screen.findByText(t.copied)).toBeTruthy();
  });

  it('falls back to a read-only, selected text area when the clipboard refuses', async () => {
    const deps = fakeDeps({ canShare: vi.fn(() => false), writeText: vi.fn(async () => Promise.reject(new Error('denied'))) });
    mount(deps);
    await userEvent.setup().click(screen.getByRole('button', { name: t.copy }));
    const area = (await screen.findByLabelText(t.captionLabel)) as HTMLTextAreaElement;
    expect(area.readOnly).toBe(true);
    expect(area.value).toBe('Svatba\n\n#love');
    expect(area.selectionStart).toBe(0);
    expect(area.selectionEnd).toBe(area.value.length);
    expect(screen.getByRole('alert').textContent).toBe(t.copyFailed);
  });

  it('downloads every file by its name, fetching first when nothing is prepared yet', async () => {
    const deps = fakeDeps({ canShare: vi.fn(() => false) });
    mount(deps);
    await userEvent.setup().click(screen.getByRole('button', { name: t.download }));
    await waitFor(() => expect(deps.download).toHaveBeenCalledTimes(3));
    expect(deps.download.mock.calls.map((c) => (c[0] as File).name)).toEqual(['foto-1.jpg', 'foto-2.jpg', 'foto-3.jpg']);
  });

  it('refuses a post without photos', () => {
    const deps = fakeDeps();
    mount(deps, post([]));
    expect(screen.getByText(t.noPhotos)).toBeTruthy();
    expect(button(t.share)).toBeNull();
    expect(button(t.copy)).toBeNull();
    expect(button(t.download)).toBeNull();
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it('says that unsaved changes are not shared', () => {
    mount(fakeDeps({ canShare: vi.fn(() => false) }), post(threePhotos), true);
    expect(screen.getByText(t.unsaved)).toBeTruthy();
  });

  it('has no serious accessibility violations', async () => {
    const { container } = mount(fakeDeps());
    await screen.findByRole('button', { name: t.share });
    expect(await seriousViolations(container)).toEqual([]);
  });
});
