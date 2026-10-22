/**
 * Reorderable list (ADMIN-UX F2): drag only, with a mouse, long-press (250 ms) with a finger, or the keyboard
 * (dnd-kit KeyboardSensor on the handle: Space/Enter lifts, arrows move, Space/Enter drops, Escape cancels;
 * Czech announcements and instructions). There are no move buttons (T-243). The moves are planned by data/order.ts (minimal
 * `{ id, sort }` updates), shown at once (optimistic) and handed to `onReorder`. If that rejects, the list
 * goes back to the saved order and offers "Zkusit znovu"; on success "Pořadí uloženo" is announced.
 *
 * Contract: when `onReorder` resolves, `items` must already carry the new order (the callers refresh their
 * query before resolving), because the optimistic copy is dropped then.
 */
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Active,
  type Announcements,
  type DragEndEvent,
  type Over,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { isStale } from '../data/concurrency';
import { useCanMutate } from '../data/health';
import { applySortUpdates, planMoveToPosition, sortedRows, type SortUpdate } from '../data/order';
import { cs, glossary } from '../i18n/cs';
import { fill } from '../i18n/format';
import { StaleNotice } from './StaleNotice';
import { useToast } from './Toast';

export interface SortableItem {
  id: string;
  sort: number;
}

/** Updates for dropping `activeId` onto the place of `overId` in the displayed order (none for the same place). */
export function planDragEnd(items: readonly SortableItem[], activeId: string, overId: string): SortUpdate[] {
  const shown = sortedRows(items);
  const to = shown.findIndex((r) => r.id === overId);
  if (to < 0 || activeId === overId) return [];
  return planMoveToPosition(shown, activeId, to + 1);
}

interface Props<T extends SortableItem> {
  /** The rows of the list (any order; they are shown by sort, then id). */
  items: readonly T[];
  /** Accessible name of the list. */
  label: string;
  /** Name of one item for buttons and announcements. */
  itemLabel: (item: T) => string;
  onReorder: (updates: SortUpdate[]) => Promise<unknown>;
  renderItem: (item: T) => ReactNode;
  /** Extra buttons of the row, after the move buttons. */
  renderActions?: (item: T) => ReactNode;
  /** Names the row type in the "changed elsewhere" notice. */
  staleEntity?: 'album' | 'category' | 'photo';
}

interface RowContext {
  canMutate: boolean;
}

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

function SortableRow<T extends SortableItem>({
  item,
  name,
  ctx,
  children,
  actions,
}: {
  item: T;
  name: string;
  ctx: RowContext;
  children: ReactNode;
  actions: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: !ctx.canMutate,
    attributes: { roleDescription: cs.reorder.roleDescription },
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition: reducedMotion() ? undefined : transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={isDragging ? 'sortable-row is-dragging' : 'sortable-row'}
      data-sortable-id={item.id}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        className="drag-handle"
        aria-label={`${cs.reorder.handle}: ${name}`}
        {...attributes}
        {...listeners}
      >
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
          <circle cx="5" cy="3" r="1.5" fill="currentColor" />
          <circle cx="11" cy="3" r="1.5" fill="currentColor" />
          <circle cx="5" cy="8" r="1.5" fill="currentColor" />
          <circle cx="11" cy="8" r="1.5" fill="currentColor" />
          <circle cx="5" cy="13" r="1.5" fill="currentColor" />
          <circle cx="11" cy="13" r="1.5" fill="currentColor" />
        </svg>
      </button>
      <div className="row-main">{children}</div>
      <div className="row-actions">
        {actions}
      </div>
    </li>
  );
}

export function SortableList<T extends SortableItem>({
  items,
  label,
  itemLabel,
  onReorder,
  renderItem,
  renderActions,
  staleEntity = 'album',
}: Props<T>) {
  const toast = useToast();
  const canMutate = useCanMutate();
  const hintId = useId();
  const listRef = useRef<HTMLOListElement>(null);
  const mounted = useRef(true);
  const busyRef = useRef(false);
  const [overlay, setOverlay] = useState<SortUpdate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ updates: SortUpdate[]; error: unknown } | null>(null);
  const [spoken, setSpoken] = useState('');

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const displayed = useMemo(
    () => (overlay ? applySortUpdates(items, overlay) : sortedRows(items)),
    [items, overlay],
  );
  const nameOf = useCallback(
    (id: string | number) => {
      const found = displayed.find((r) => r.id === String(id));
      return found ? itemLabel(found) : '';
    },
    [displayed, itemLabel],
  );

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function commit(updates: SortUpdate[], movedId: string | null) {
    if (updates.length === 0 || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setFailure(null);
    setOverlay(updates);
    if (movedId) {
      const position = applySortUpdates(displayed, updates).findIndex((r) => r.id === movedId) + 1;
      setSpoken(
        fill(cs.reorder.dropped, { name: nameOf(movedId), position, total: displayed.length }),
      );
    }
    try {
      await onReorder(updates);
      if (mounted.current) setOverlay(null);
      toast.show(cs.reorder.saved);
    } catch (error) {
      if (mounted.current) {
        setOverlay(null);
        setFailure({ updates, error });
        setSpoken('');
      }
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || busyRef.current) return;
    void commit(planDragEnd(displayed, String(active.id), String(over.id)), String(active.id));
  }

  const positionOf = (id: string | number) => displayed.findIndex((r) => r.id === String(id)) + 1;
  const say = (template: string, active: Active, at: Active | Over | null = active) =>
    setSpoken(
      fill(template, { name: nameOf(active.id), position: positionOf(at ? at.id : active.id), total: displayed.length }),
    );
  // dnd-kit's own live region is `assertive` and cannot be changed, so its announcements stay silent and the
  // Czech texts go to this list's polite region instead.
  const silent: Announcements = {
    onDragStart: () => undefined,
    onDragOver: () => undefined,
    onDragEnd: () => undefined,
    onDragCancel: () => undefined,
  };

  return (
    <div className="sortable">
      <p id={hintId} className="field-hint">
        {cs.reorder.listHint}
      </p>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={({ active }) => say(cs.reorder.pickedUp, active)}
        onDragOver={({ active, over }) => {
          // Over itself (the start) keeps the "picked up" sentence.
          if (over && over.id !== active.id) say(cs.reorder.over, active, over);
        }}
        onDragCancel={({ active }) => say(cs.reorder.cancelled, active)}
        onDragEnd={(event) => {
          if (!event.over || event.over.id === event.active.id) say(cs.reorder.droppedSame, event.active);
          onDragEnd(event);
        }}
        accessibility={{
          announcements: silent,
          screenReaderInstructions: { draggable: cs.reorder.instructions },
        }}
      >
        <SortableContext items={displayed.map((r) => r.id)} strategy={verticalListSortingStrategy}>
          <ol ref={listRef} className="sortable-list" aria-label={label} aria-describedby={hintId} aria-busy={busy}>
            {displayed.map((item) => (
              <SortableRow
                key={item.id}
                item={item}
                name={itemLabel(item)}
                actions={renderActions?.(item)}
                ctx={{ canMutate }}
              >
                {renderItem(item)}
              </SortableRow>
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      <p className="visually-hidden" role="status" aria-live="polite">
        {spoken}
      </p>
      {failure ? (
        isStale(failure.error) ? (
          <StaleNotice entity={staleEntity} onReload={() => setFailure(null)} />
        ) : (
          <div className="notice notice-error" role="alert">
            <p>{cs.reorder.failed}</p>
            <button
              type="button"
              className="button"
              disabled={!canMutate}
              onClick={() => void commit(failure.updates, null)}
            >
              {glossary.retry}
            </button>
          </div>
        )
      ) : null}
    </div>
  );
}
