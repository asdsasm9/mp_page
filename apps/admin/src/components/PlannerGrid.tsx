/**
 * Instagram planning grid (WP-14): three columns, tiles 3:4 with a centre crop, profile order (open posts by sort,
 * then posted by date). Only planned and draft posts are sortable: the SortableContext holds their ids, posted tiles
 * stay behind them. Same sensors as SortableList (mouse 5 px, touch hold 250 ms, keyboard), rectSortingStrategy.
 * A drop is planned by planDragEnd (minimal `{ id, sort }` updates), shown at once and saved through
 * useReorderIgPosts; when the save fails the grid goes back to the saved order and offers "Zkusit znovu".
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
  type Over,
} from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { effectiveStatus, type IgPost } from '@mp/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { plannerKeys, useReorderIgPosts } from '../data/planner';
import { useCanMutate } from '../data/health';
import { applySortUpdates, sortedRows, type SortUpdate } from '../data/order';
import { cs, glossary } from '../i18n/cs';
import { fill } from '../i18n/format';
import { PostTile, SortablePostTile, postName } from './PostTile';
import { planDragEnd } from './SortableList';
import { useToast } from './Toast';

interface Props {
  /** Posts in profile order (as listPosts returns them). */
  posts: readonly IgPost[];
  imgBase: string;
}

export function PlannerGrid({ posts, imgBase }: Props) {
  const toast = useToast();
  const canMutate = useCanMutate();
  const queryClient = useQueryClient();
  const reorder = useReorderIgPosts();
  const hintId = useId();
  const mounted = useRef(true);
  const busyRef = useRef(false);
  const [overlay, setOverlay] = useState<SortUpdate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<SortUpdate[] | null>(null);
  const [spoken, setSpoken] = useState('');

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const open = useMemo(() => {
    const rows = posts.filter((p) => p.status !== 'posted');
    return overlay ? applySortUpdates(rows, overlay) : sortedRows(rows);
  }, [posts, overlay]);
  const posted = useMemo(() => posts.filter((p) => p.status === 'posted'), [posts]);
  const shown = useMemo(() => [...open, ...posted], [open, posted]);
  // The next post to publish is the last ready (planned) one, next to the posted block.
  const nextId = useMemo(() => [...open].reverse().find((p) => effectiveStatus(p) === 'planned')?.id ?? null, [open]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const positionOf = (id: string | number) => shown.findIndex((p) => p.id === String(id)) + 1;
  const say = (template: string, active: Active, at: Active | Over | null = active) =>
    setSpoken(
      fill(template, { name: postName(positionOf(active.id)), position: positionOf(at ? at.id : active.id), total: shown.length }),
    );
  // dnd-kit's own live region is assertive and cannot be changed; the Czech sentences go to this polite region.
  const silent: Announcements = {
    onDragStart: () => undefined,
    onDragOver: () => undefined,
    onDragEnd: () => undefined,
    onDragCancel: () => undefined,
  };

  async function commit(updates: SortUpdate[], movedId: string | null) {
    if (updates.length === 0 || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setFailure(null);
    setOverlay(updates);
    if (movedId) {
      const position = applySortUpdates(open, updates).findIndex((p) => p.id === movedId) + 1;
      setSpoken(fill(cs.reorder.dropped, { name: postName(position), position, total: shown.length }));
    }
    try {
      await reorder.mutateAsync(updates);
      if (mounted.current) setOverlay(null);
      toast.show(cs.reorder.saved);
    } catch {
      // Some rows may have been written: show what the database has now.
      await queryClient.invalidateQueries({ queryKey: plannerKeys.all });
      if (mounted.current) {
        setOverlay(null);
        setFailure(updates);
        setSpoken('');
      }
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const disabled = !canMutate || busy;

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
          if (over && over.id !== active.id) say(cs.reorder.over, active, over);
        }}
        onDragCancel={({ active }) => say(cs.reorder.cancelled, active)}
        onDragEnd={({ active, over }) => {
          if (!over || over.id === active.id) {
            say(cs.reorder.droppedSame, active);
            return;
          }
          if (busyRef.current) return;
          void commit(planDragEnd(open, String(active.id), String(over.id)), String(active.id));
        }}
        accessibility={{ announcements: silent, screenReaderInstructions: { draggable: cs.reorder.instructions } }}
      >
        <SortableContext items={open.map((p) => p.id)} strategy={rectSortingStrategy}>
          <ul className="ig-grid" aria-label={cs.instagram.gridLabel} aria-describedby={hintId} aria-busy={busy}>
            {open.map((post) => (
              <SortablePostTile
                key={post.id}
                post={post}
                position={positionOf(post.id)}
                imgBase={imgBase}
                isNext={post.id === nextId}
                disabled={disabled}
              />
            ))}
            {posted.map((post) => (
              <PostTile key={post.id} post={post} position={positionOf(post.id)} imgBase={imgBase} isNext={false} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      <p className="visually-hidden" role="status" aria-live="polite">
        {spoken}
      </p>
      {failure ? (
        <div className="notice notice-error" role="alert">
          <p>{cs.reorder.failed}</p>
          <button type="button" className="button" disabled={!canMutate} onClick={() => void commit(failure, null)}>
            {glossary.retry}
          </button>
        </div>
      ) : null}
    </div>
  );
}
