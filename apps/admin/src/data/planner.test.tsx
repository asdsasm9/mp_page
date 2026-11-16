import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeWorld, fixtureSnapshot } from '../adapters/fake';
import { AppProviders } from '../AppProviders';
import { AuthLayout, ShellLayout } from '../components/Layouts';
import { LoginPage } from '../auth/LoginPage';
import { RequireAuth } from '../auth/RequireAuth';
import { NetworkError } from '../ports';
import {
  useCreateIgPost,
  useDeleteIgPost,
  useIgPosts,
  useMarkIgPostPosted,
  useReorderIgPosts,
  useSetIgPostPhotos,
  useUnmarkIgPostPosted,
  useUpdateIgPost,
} from './planner';

afterEach(cleanup);

function Screen({ photoIds }: { photoIds: string[] }) {
  const posts = useIgPosts();
  const create = useCreateIgPost();
  const update = useUpdateIgPost();
  const setPhotos = useSetIgPostPhotos();
  const reorder = useReorderIgPosts();
  const mark = useMarkIgPostPosted();
  const unmark = useUnmarkIgPostPosted();
  const del = useDeleteIgPost();
  const first = posts.data?.[0];
  const second = posts.data?.[1];
  return (
    <div>
      <h1>Plan</h1>
      <p data-testid="list">
        {posts.data?.map((p) => `${p.caption}:${p.status}:${p.photos.length}`).join('|') ?? 'loading'}
      </p>
      <p data-testid="error">{create.error instanceof NetworkError ? 'network' : ''}</p>
      <button type="button" onClick={() => create.mutate({ caption: 'Prvni', photoIds: [photoIds[0]!], status: 'planned' })}>create</button>
      <button type="button" onClick={() => create.mutate({ caption: 'Druhy', photoIds: [photoIds[1]!] })}>create2</button>
      <button type="button" onClick={() => first && update.mutate({ id: first.id, patch: { caption: 'Zmeneno' } })}>update</button>
      <button type="button" onClick={() => first && setPhotos.mutate({ id: first.id, photoIds: [photoIds[2]!, photoIds[3]!] })}>photos</button>
      <button type="button" onClick={() => first && second && reorder.mutate([{ id: first.id, sort: 100 }])}>reorder</button>
      <button type="button" onClick={() => first && mark.mutate({ id: first.id, postedAt: '2026-11-16T10:00:00.000Z' })}>mark</button>
      <button type="button" onClick={() => first && unmark.mutate({ id: first.id })}>unmark</button>
      <button type="button" onClick={() => first && del.mutate(first.id)}>delete</button>
    </div>
  );
}

function setup() {
  const world = createFakeWorld({ signedIn: true, seed: fixtureSnapshot() });
  const photoIds = (world.snapshot().photos as { id: string }[]).map((p) => p.id);
  render(
    <AppProviders ports={world.ports} retry={false}>
      <MemoryRouter>
        <Routes>
          <Route element={<AuthLayout />}>
            <Route path="/prihlaseni" element={<LoginPage />} />
          </Route>
          <Route element={<RequireAuth />}>
            <Route element={<ShellLayout />}>
              <Route path="/" element={<Screen photoIds={photoIds} />} />
            </Route>
          </Route>
        </Routes>
      </MemoryRouter>
    </AppProviders>,
  );
  return world;
}

const list = () => screen.getByTestId('list').textContent;

describe('planner hooks', () => {
  it('load through the port once the session is ready, and every mutation refreshes the list', async () => {
    const user = userEvent.setup();
    const world = setup();
    await waitFor(() => expect(list()).toBe(''));

    await user.click(screen.getByText('create'));
    await waitFor(() => expect(list()).toBe('Prvni:planned:1'));
    await user.click(screen.getByText('create2'));
    await waitFor(() => expect(list()).toBe('Druhy:draft:1|Prvni:planned:1'));

    await user.click(screen.getByText('update'));
    await waitFor(() => expect(list()).toBe('Zmeneno:draft:1|Prvni:planned:1'));
    await user.click(screen.getByText('photos'));
    await waitFor(() => expect(list()).toBe('Zmeneno:draft:2|Prvni:planned:1'));
    await user.click(screen.getByText('reorder'));
    await waitFor(() => expect(list()).toBe('Prvni:planned:1|Zmeneno:draft:2'));

    await user.click(screen.getByText('mark'));
    await waitFor(() => expect(list()).toBe('Zmeneno:draft:2|Prvni:posted:1'));
    await user.click(screen.getByText('delete'));
    await waitFor(() => expect(list()).toBe('Prvni:posted:1'));
    await user.click(screen.getByText('unmark'));
    await waitFor(() => expect(list()).toBe('Prvni:planned:1'));

    // Planner writes are never site changes.
    expect(world.snapshot().site.pending_changes).toBe(0);
  });

  it('a failed mutation surfaces its error and leaves the list alone', async () => {
    const user = userEvent.setup();
    const world = setup();
    await waitFor(() => expect(list()).toBe(''));
    world.failNext('planner.createPost', 'network');
    await user.click(screen.getByText('create'));
    await waitFor(() => expect(screen.getByTestId('error').textContent).toBe('network'));
    expect(list()).toBe('');
    expect(await world.ports.planner.listPosts()).toEqual([]);
  });
});
