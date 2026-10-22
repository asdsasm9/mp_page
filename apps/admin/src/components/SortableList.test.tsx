import axe from 'axe-core';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeWorld } from '../adapters/fake';
import { AppProviders } from '../AppProviders';
import { applySortUpdates, planMoveToPosition, type SortUpdate } from '../data/order';
import { cs } from '../i18n/cs';
import { CatalogError } from '../ports';
import { planDragEnd, SortableList } from './SortableList';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

interface Row {
  id: string;
  sort: number;
  name: string;
}

const ROWS: Row[] = [
  { id: 'a', sort: 10, name: 'Svatby' },
  { id: 'b', sort: 20, name: 'Portréty' },
  { id: 'c', sort: 30, name: 'Rodina' },
];

type Save = (updates: SortUpdate[]) => Promise<unknown>;

function Harness({ save, initial = ROWS }: { save: Save; initial?: Row[] }) {
  const [rows, setRows] = useState(initial);
  return (
    <SortableList
      items={rows}
      label="Kategorie"
      itemLabel={(r) => r.name}
      staleEntity="category"
      onReorder={async (updates) => {
        await save(updates);
        setRows((current) => applySortUpdates(current, updates));
      }}
      renderItem={(r) => <span>{r.name}</span>}
    />
  );
}

function setup(save: Save, initial?: Row[]) {
  const world = createFakeWorld({ signedIn: true });
  const view = render(
    <AppProviders ports={world.ports} retry={false}>
      <MemoryRouter>{initial ? <Harness save={save} initial={initial} /> : <Harness save={save} />}</MemoryRouter>
    </AppProviders>,
  );
  return view;
}

const names = () =>
  within(screen.getByRole('list', { name: 'Kategorie' }))
    .getAllByRole('listitem')
    .map((li) => li.querySelector('.row-main')!.textContent);

/** jsdom has no layout: give the rows rectangles in list order (restored by `cleanup` via restoreAllMocks). */
function mockRects() {
  return vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const li = this.closest('[data-sortable-id]') ?? (this.matches('[data-sortable-id]') ? this : null);
    const id = li?.getAttribute('data-sortable-id');
    const top = id ? ['a', 'b', 'c'].indexOf(id) * 100 : 0;
    return { x: 0, y: top, top, left: 0, right: 300, bottom: top + 80, width: 300, height: 80, toJSON: () => ({}) };
  });
}

/** Lifts the handle of "Svatby" with Space, moves it one place down and drops it with Space. */
async function dragSvatbyDown(user: ReturnType<typeof userEvent.setup>) {
  const handle = screen.getByRole('button', { name: 'Přetáhnout: Svatby' });
  handle.focus();
  await user.keyboard(' ');
  await user.keyboard('{ArrowDown}');
  await user.keyboard(' ');
}

describe('no move buttons (T-243)', () => {
  it('has only the drag handle per row, no text buttons for moving', () => {
    setup(vi.fn<Save>(async () => undefined));
    const rows = within(screen.getByRole('list', { name: 'Kategorie' })).getAllByRole('listitem');
    for (const row of rows) {
      const labels = within(row).getAllByRole('button').map((b) => b.getAttribute('aria-label'));
      expect(labels).toHaveLength(1);
      expect(labels[0]).toMatch(/^Přetáhnout: /);
    }
    expect(screen.queryByRole('button', { name: /Posunout|Přesunout do pozice/ })).toBeNull();
  });
});

describe('optimistic update and rollback', () => {
  it('shows the new order at once and goes back with "Pořadí se nepodařilo uložit" + retry when saving fails', async () => {
    mockRects();
    const user = userEvent.setup();
    let reject: (e: Error) => void = () => undefined;
    const save = vi
      .fn<Save>()
      .mockImplementationOnce(() => new Promise((_, r) => (reject = r)))
      .mockResolvedValue(undefined);
    setup(save);
    await dragSvatbyDown(user);
    // Not saved yet, already shown.
    await waitFor(() => expect(names()).toEqual(['Portréty', 'Svatby', 'Rodina']));
    expect(save.mock.calls[0]![0]).toEqual([{ id: 'a', sort: 25 }]);
    await act(async () => reject(new Error('boom')));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Pořadí se nepodařilo uložit');
    expect(names()).toEqual(['Svatby', 'Portréty', 'Rodina']);

    await user.click(within(alert).getByRole('button', { name: 'Zkusit znovu' }));
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]![0]).toEqual(save.mock.calls[0]![0]);
    await waitFor(() => expect(names()).toEqual(['Portréty', 'Svatby', 'Rodina']));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(await screen.findByText(cs.reorder.saved)).toBeTruthy();
  });

  it('a conflict shows the "changed elsewhere" notice for the entity', async () => {
    mockRects();
    const user = userEvent.setup();
    setup(vi.fn<Save>().mockRejectedValue(new CatalogError('STALE')));
    await dragSvatbyDown(user);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(`Tato kategorie byla změněna jinde.${cs.data.reload}`);
    expect(names()).toEqual(['Svatby', 'Portréty', 'Rodina']);
  });

  it('ignores a second move while one is being saved', async () => {
    mockRects();
    const user = userEvent.setup();
    let resolve: () => void = () => undefined;
    const save = vi.fn<Save>(() => new Promise<void>((r) => (resolve = r)));
    setup(save);
    await dragSvatbyDown(user);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const handle = screen.getByRole('button', { name: 'Přetáhnout: Rodina' });
    handle.focus();
    await user.keyboard(' ');
    await user.keyboard('{ArrowUp}');
    await user.keyboard(' ');
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => resolve());
  });
});

describe('dragging', () => {
  it('planDragEnd plans the move to the place of the row dropped on', () => {
    expect(planDragEnd(ROWS, 'a', 'c')).toEqual(planMoveToPosition(ROWS, 'a', 3));
    expect(planDragEnd(ROWS, 'c', 'a')).toEqual(planMoveToPosition(ROWS, 'c', 1));
    expect(planDragEnd(ROWS, 'a', 'a')).toEqual([]);
    expect(planDragEnd(ROWS, 'a', 'nope')).toEqual([]);
  });

  it('the keyboard sensor moves a row (Space, arrow, Space) and the instructions are Czech', async () => {
    const rect = mockRects();
    const user = userEvent.setup();
    const save = vi.fn<Save>(async () => undefined);
    setup(save);
    const handle = screen.getByRole('button', { name: 'Přetáhnout: Svatby' });
    expect(handle.getAttribute('aria-roledescription')).toBe(cs.reorder.roleDescription);
    const described = document.getElementById(handle.getAttribute('aria-describedby')!)!;
    expect(described.textContent).toBe(cs.reorder.instructions);
    handle.focus();
    await user.keyboard(' ');
    expect(await screen.findByText('Svatby zvednuto. Pozice 1 z 3.')).toBeTruthy();
    await user.keyboard('{ArrowDown}');
    expect(await screen.findByText('Svatby je nad pozicí 2 z 3.')).toBeTruthy();
    await user.keyboard(' ');
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]![0]).toEqual(planMoveToPosition(ROWS, 'a', 2));
    await waitFor(() => expect(names()).toEqual(['Portréty', 'Svatby', 'Rodina']));
    expect(screen.getByText('Svatby přesunuto na pozici 2 z 3.')).toBeTruthy();
    expect((await screen.findByText(cs.reorder.saved)).closest('[role="status"]')).not.toBeNull();
    rect.mockRestore();
  });
});

describe('accessibility', () => {
  it('has no serious axe violations', async () => {
    const { container } = setup(vi.fn<Save>(async () => undefined));
    const run = () =>
      axe.run(container, {
        runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
        rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
      });
    const bad = (r: Awaited<ReturnType<typeof run>>) =>
      r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id);
    expect(bad(await run())).toEqual([]);
  });
});
