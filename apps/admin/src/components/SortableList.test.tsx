import axe from 'axe-core';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeWorld } from '../adapters/fake';
import { AppProviders } from '../AppProviders';
import { applySortUpdates, planMove, planMoveToPosition, type SortUpdate } from '../data/order';
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

describe('buttons', () => {
  it('"Posunout dolů" saves the planned rows, shows the new order and says "Pořadí uloženo"', async () => {
    const user = userEvent.setup();
    const save = vi.fn<Save>(async () => undefined);
    setup(save);
    await user.click(screen.getByRole('button', { name: 'Posunout dolů: Svatby' }));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(planMove(ROWS, 'a', 1));
    expect(save.mock.calls[0]![0]).toEqual([{ id: 'a', sort: 25 }]);
    await waitFor(() => expect(names()).toEqual(['Portréty', 'Svatby', 'Rodina']));
    expect((await screen.findByText(cs.reorder.saved)).closest('[role="status"]')).not.toBeNull();
    // The pressed button keeps focus, so a second press continues from the keyboard.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Posunout dolů: Svatby' }));
    // Spoken (polite) in Czech.
    expect(screen.getByText('Svatby přesunuto na pozici 2 z 3.')).toBeTruthy();
  });

  it('"Posunout nahoru" at the top does nothing', async () => {
    const user = userEvent.setup();
    const save = vi.fn<Save>(async () => undefined);
    setup(save);
    const up = screen.getByRole('button', { name: 'Posunout nahoru: Svatby' });
    expect(up.getAttribute('aria-disabled')).toBe('true');
    await user.click(up);
    expect(save).not.toHaveBeenCalled();
  });

  it('"Přesunout do pozice…" moves to the typed position; a bad number is refused without saving', async () => {
    const user = userEvent.setup();
    const save = vi.fn<Save>(async () => undefined);
    setup(save);
    const open = screen.getByRole('button', { name: 'Přesunout do pozice… Rodina' });
    await user.click(open);
    const input = screen.getByLabelText('Nová pozice (1 až 3)');
    expect(document.activeElement).toBe(input);
    await user.clear(input);
    await user.type(input, '9{Enter}');
    expect(screen.getByText('Zadejte číslo od 1 do 3.')).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
    await user.clear(input);
    await user.type(input, '1{Enter}');
    expect(save).toHaveBeenCalledWith(planMoveToPosition(ROWS, 'c', 1));
    await waitFor(() => expect(names()).toEqual(['Rodina', 'Svatby', 'Portréty']));
    expect(screen.queryByLabelText('Nová pozice (1 až 3)')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Přesunout do pozice… Rodina' })));
  });

  it('Escape closes the position form and returns focus to its button', async () => {
    const user = userEvent.setup();
    setup(vi.fn<Save>(async () => undefined));
    await user.click(screen.getByRole('button', { name: 'Přesunout do pozice… Portréty' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByLabelText('Nová pozice (1 až 3)')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Přesunout do pozice… Portréty' }));
  });
});

describe('optimistic update and rollback', () => {
  it('shows the new order at once and goes back with "Pořadí se nepodařilo uložit" + retry when saving fails', async () => {
    const user = userEvent.setup();
    let reject: (e: Error) => void = () => undefined;
    const save = vi
      .fn<Save>()
      .mockImplementationOnce(() => new Promise((_, r) => (reject = r)))
      .mockResolvedValue(undefined);
    setup(save);
    await user.click(screen.getByRole('button', { name: 'Posunout dolů: Svatby' }));
    // Not saved yet, already shown.
    expect(names()).toEqual(['Portréty', 'Svatby', 'Rodina']);
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
    const user = userEvent.setup();
    setup(vi.fn<Save>().mockRejectedValue(new CatalogError('STALE')));
    await user.click(screen.getByRole('button', { name: 'Posunout dolů: Svatby' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(`Tato kategorie byla změněna jinde.${cs.data.reload}`);
    expect(names()).toEqual(['Svatby', 'Portréty', 'Rodina']);
  });

  it('ignores a second move while one is being saved', async () => {
    const user = userEvent.setup();
    let resolve: () => void = () => undefined;
    const save = vi.fn<Save>(() => new Promise<void>((r) => (resolve = r)));
    setup(save);
    await user.click(screen.getByRole('button', { name: 'Posunout dolů: Svatby' }));
    await user.click(screen.getByRole('button', { name: 'Posunout dolů: Rodina' }));
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
    // jsdom has no layout: give the rows rectangles in list order.
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const li = this.closest('[data-sortable-id]') ?? (this.matches('[data-sortable-id]') ? this : null);
      const id = li?.getAttribute('data-sortable-id');
      const top = id ? ['a', 'b', 'c'].indexOf(id) * 100 : 0;
      return { x: 0, y: top, top, left: 0, right: 300, bottom: top + 80, width: 300, height: 80, toJSON: () => ({}) };
    });
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
    rect.mockRestore();
  });
});

describe('accessibility', () => {
  it('has no serious axe violations (closed and with the position form open)', async () => {
    const user = userEvent.setup();
    const { container } = setup(vi.fn<Save>(async () => undefined));
    const run = () =>
      axe.run(container, {
        runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
        rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
      });
    const bad = (r: Awaited<ReturnType<typeof run>>) =>
      r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id);
    expect(bad(await run())).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Přesunout do pozice… Portréty' }));
    expect(bad(await run())).toEqual([]);
  });
});
