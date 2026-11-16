/**
 * The photos of a post in carousel order (WP-14, 1 to 10): a SortableList of thumbnails with an order number and a
 * "Odebrat" button. The order is only kept in the editor until "Uložit"; the first photo is the one the grid shows.
 */
import { useCallback, useEffect, useRef } from 'react';
import { applySortUpdates, type SortUpdate } from '../data/order';
import { useCanMutate } from '../data/health';
import { photoWebpUrl } from '../data/images';
import { cs } from '../i18n/cs';
import { fill } from '../i18n/format';
import { SortableList } from './SortableList';

interface Props {
  /** Photo ids in carousel order. */
  photoIds: readonly string[];
  imgBase: string;
  onChange: (photoIds: string[]) => void;
  /** The last photo was removed: the strip disappears, the caller moves focus somewhere useful. */
  onLastRemoved?: () => void;
}

interface Item {
  id: string;
  sort: number;
}

export function PostPhotoStrip({ photoIds, imgBase, onChange, onLastRemoved }: Props) {
  const canMutate = useCanMutate();
  const root = useRef<HTMLDivElement>(null);
  const focusIndex = useRef<number | null>(null);

  // The removed row's button is gone: focus goes to the button that took its place (or the one before it).
  useEffect(() => {
    if (focusIndex.current === null) return;
    const buttons = root.current?.querySelectorAll<HTMLButtonElement>('button[data-photo-remove]');
    buttons?.[Math.min(focusIndex.current, buttons.length - 1)]?.focus();
    focusIndex.current = null;
  }, [photoIds]);

  function remove(id: string) {
    if (photoIds.length === 1) onLastRemoved?.();
    else focusIndex.current = photoIds.indexOf(id);
    onChange(photoIds.filter((x) => x !== id));
  }
  const items: Item[] = photoIds.map((id, index) => ({ id, sort: index + 1 }));
  const numberOf = useCallback((id: string) => photoIds.indexOf(id) + 1, [photoIds]);
  const nameOf = useCallback(
    (item: Item) => fill(cs.instagram.editor.photoName, { n: numberOf(item.id) }),
    [numberOf],
  );

  async function reorder(updates: SortUpdate[]) {
    // Local only: the new order is applied at once and saved with "Uložit".
    onChange(applySortUpdates(items, updates).map((row) => row.id));
  }

  return (
    <div ref={root}>
    <SortableList
      items={items}
      label={cs.instagram.editor.stripLabel}
      itemLabel={nameOf}
      onReorder={reorder}
      movedMessage={cs.instagram.editor.orderChanged}
      renderItem={(item) => {
        const src = photoWebpUrl(imgBase, item.id, 480);
        const n = numberOf(item.id);
        return (
          <div className="post-strip-item">
            {src ? (
              <img className="post-strip-img" src={src} width={480} height={640} alt="" loading="lazy" decoding="async" />
            ) : (
              <span className="post-strip-img" />
            )}
            <span className="post-strip-number">{fill(cs.instagram.editor.photoName, { n })}</span>
          </div>
        );
      }}
      renderActions={(item) => (
        <button
          type="button"
          className="button"
          data-photo-remove=""
          disabled={!canMutate}
          aria-label={fill(cs.instagram.editor.removeLabel, { n: numberOf(item.id) })}
          onClick={() => remove(item.id)}
        >
          {cs.instagram.editor.remove}
        </button>
      )}
    />
    </div>
  );
}
