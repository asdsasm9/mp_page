/**
 * Optimistic photo reordering shared by the grid (drag, keyboard) and the tile menu (start, end, position).
 * The new order is shown at once; if the save fails the grid goes back to the saved order and offers a retry.
 * Like SortableList: when `commit` resolves the query already carries the new order.
 */
import type { PhotoRow } from '@mp/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePhotoActions } from '../data/photoActions';
import { applySortUpdates, sortedRows, type SortUpdate } from '../data/order';
import { cs } from '../i18n/cs';
import { useToast } from './Toast';

export function usePhotoReorder(photos: readonly PhotoRow[]) {
  const toast = useToast();
  const actions = usePhotoActions();
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

  const displayed = useMemo(() => (overlay ? applySortUpdates(photos, overlay) : sortedRows(photos)), [photos, overlay]);

  const commit = useCallback(
    async (updates: SortUpdate[], announcement?: (rows: PhotoRow[]) => string) => {
      if (updates.length === 0 || busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setFailure(null);
      setOverlay(updates);
      if (announcement) setSpoken(announcement(applySortUpdates(photos, updates)));
      try {
        await actions.reorder(updates, photos);
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
    },
    [actions, photos, toast],
  );

  return { displayed, busy, failure, spoken, setSpoken, commit, dismissFailure: () => setFailure(null) };
}
