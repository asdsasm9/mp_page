/**
 * Photo grid of an album (ADMIN-UX 3.4): square tiles with the 480 px WebP (URL from the shared key helper,
 * never built by hand), a dominant-colour placeholder behind the image, the "Titulní" badge and a dot on photos
 * without alt text. Drag with the handle (mouse, 250 ms touch hold, keyboard); every move also exists as menu
 * buttons (WCAG 2.5.7). Selection mode: checkbox on each tile, entered with "Vybrat" or a long press.
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
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { PhotoRow } from '@mp/shared';
import { useRef, useState, type PointerEvent } from 'react';
import { Link } from 'react-router-dom';
import { hasNoAlt } from '../data/altText';
import { photoWebpUrl } from '../data/images';
import { photoQuality } from '../data/photoQuality';
import { QualityBadges } from './QualityBadge';
import { useCanMutate } from '../data/health';
import { cs } from '../i18n/cs';
import { fill } from '../i18n/format';
import { useUploadActionsOptional } from '../upload/UploadProvider';

/** How long a finger must rest on a tile to start selection mode. */
export const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE_PX = 10;
const TILE_PX = 480;

const COLOR_RE = /^#[0-9a-f]{6}$/i;

/** Tile display size for width/height attributes: 480 px wide at the photo's own ratio. */
export function tileSize(photo: Pick<PhotoRow, 'width' | 'height'>): { width: number; height: number } {
  const ratio = photo.width > 0 && photo.height > 0 ? photo.height / photo.width : 1;
  return { width: TILE_PX, height: Math.max(1, Math.round(TILE_PX * ratio)) };
}

export interface PhotoGridProps {
  /** Every photo of the album in display order. */
  photos: readonly PhotoRow[];
  /** Filter: only these are shown (and dragging is off); null = all. */
  visibleIds: ReadonlySet<string> | null;
  coverId: string | null;
  /** The main photo of the album's category, if it is one of these photos (badge "Hlavní fotka kategorie"). */
  categoryCoverId?: string | null;
  imgBase: string;
  albumId: string;
  selecting: boolean;
  selected: ReadonlySet<string>;
  busy: boolean;
  /** Photos whose deletion did not finish; their tiles say "Mazání selhalo". */
  failedIds?: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onLongPress: (id: string) => void;
  onMenu: (id: string) => void;
  onDrop: (activeId: string, overId: string) => void;
  onSpeak: (text: string) => void;
}

interface TileProps {
  photo: PhotoRow;
  position: number;
  isCover: boolean;
  isCategoryCover: boolean;
  imgBase: string;
  albumId: string;
  selecting: boolean;
  checked: boolean;
  reorderable: boolean;
  busy: boolean;
  deleteFailed: boolean;
  onToggle: (id: string) => void;
  onLongPress: (id: string) => void;
  onMenu: (id: string) => void;
}

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

function Tile(props: TileProps) {
  const { photo, position, isCover, imgBase, albumId, selecting, checked, reorderable, busy } = props;
  const canMutate = useCanMutate();
  const name = fill(cs.photos.tileName, { n: position });
  const sortable = useSortable({
    id: photo.id,
    disabled: !reorderable || !canMutate,
    attributes: { roleDescription: cs.reorder.roleDescription },
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const longPressed = useRef(false);

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const onPointerDown = (event: PointerEvent) => {
    if (selecting || !canMutate || (event.pointerType === 'mouse' && event.button !== 0)) return;
    origin.current = { x: event.clientX, y: event.clientY };
    longPressed.current = false;
    clearTimer();
    timer.current = setTimeout(() => {
      timer.current = null;
      longPressed.current = true;
      props.onLongPress(photo.id);
    }, LONG_PRESS_MS);
  };
  const onPointerMove = (event: PointerEvent) => {
    const start = origin.current;
    if (!timer.current || !start) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > MOVE_TOLERANCE_PX) clearTimer();
  };

  // A photo just uploaded shows the local file until the public image (CDN) has loaded.
  const uploads = useUploadActionsOptional();
  const [publicLoaded, setPublicLoaded] = useState(false);
  const preview = publicLoaded ? undefined : uploads?.previewFor(photo.id);
  const src = photoWebpUrl(imgBase, photo.id, 480);
  const size = tileSize(photo);
  const color = photo.dominant_color && COLOR_RE.test(photo.dominant_color) ? photo.dominant_color : undefined;
  const alt = photo.alt?.trim() ? photo.alt.trim() : name;

  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: reducedMotion() ? undefined : sortable.transition,
  };

  return (
    <li
      ref={sortable.setNodeRef}
      style={style}
      className={sortable.isDragging ? 'photo-tile is-dragging' : 'photo-tile'}
      data-photo-id={photo.id}
      data-selected={checked || undefined}
      data-cover={isCover || undefined}
    >
      <div
        className="photo-frame"
        style={color ? { backgroundColor: color } : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={clearTimer}
        onPointerCancel={clearTimer}
        onPointerLeave={clearTimer}
      >
        <Link
          className="photo-link"
          to={`/alba/${albumId}/foto/${photo.id}`}
          onClick={(event) => {
            if (longPressed.current) {
              event.preventDefault();
              longPressed.current = false;
            } else if (selecting) {
              event.preventDefault();
              props.onToggle(photo.id);
            }
          }}
        >
          {src ? (
            <img
              className="photo-img"
              src={src}
              width={size.width}
              height={size.height}
              alt={alt}
              loading="lazy"
              decoding="async"
              onLoad={() => {
                setPublicLoaded(true);
                uploads?.releasePreview(photo.id);
              }}
            />
          ) : null}
          {preview && !publicLoaded ? (
            <img className="photo-img photo-local" src={preview} alt="" aria-hidden="true" width={size.width} height={size.height} />
          ) : null}
        </Link>
      </div>
      <div className="photo-badges">
        {isCover ? <span className="photo-badge">{cs.photos.cover}</span> : null}
        {props.isCategoryCover ? (
          <span className="photo-badge photo-badge-category" data-category-cover="">
            {cs.categoryCover.heading}
          </span>
        ) : null}
        {props.deleteFailed ? <span className="photo-badge photo-badge-danger">{cs.delete.tileFailed}</span> : null}
        <QualityBadges quality={photoQuality(photo)} hideGood className="quality-badge-tile" />
        {hasNoAlt(photo) ? (
          <span className="photo-dot" role="img" aria-label={cs.photos.altMissingDot} title={cs.photos.altMissingDot} />
        ) : null}
      </div>
      {reorderable && !selecting ? (
        <button
          type="button"
          ref={sortable.setActivatorNodeRef}
          className="photo-handle"
          aria-label={fill(cs.photos.handle, { n: position })}
          disabled={!canMutate || busy}
          {...sortable.attributes}
          {...sortable.listeners}
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
      ) : null}
      {selecting ? (
        <label className="photo-check">
          <input
            type="checkbox"
            checked={checked}
            aria-label={fill(cs.photos.selectPhoto, { n: position })}
            onChange={() => props.onToggle(photo.id)}
          />
        </label>
      ) : (
        <button
          type="button"
          className="photo-menu-button"
          aria-label={fill(cs.photos.menu, { n: position })}
          aria-haspopup="dialog"
          onClick={() => props.onMenu(photo.id)}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
            <circle cx="3" cy="8" r="1.5" fill="currentColor" />
            <circle cx="8" cy="8" r="1.5" fill="currentColor" />
            <circle cx="13" cy="8" r="1.5" fill="currentColor" />
          </svg>
        </button>
      )}
    </li>
  );
}

export function PhotoGrid(props: PhotoGridProps) {
  const { photos, visibleIds, selecting, busy } = props;
  const canMutate = useCanMutate();
  const reorderable = visibleIds === null && !selecting;
  const shown = visibleIds ? photos.filter((p) => visibleIds.has(p.id)) : photos;

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    // Arrow keys move to the closest tile in that direction, which suits a grid (up/down change the row).
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const positionOf = (id: string | number) => photos.findIndex((p) => p.id === String(id)) + 1;
  const say = (template: string, active: Active, at: Active | Over | null = active) =>
    props.onSpeak(
      fill(template, {
        name: fill(cs.photos.tileName, { n: positionOf(active.id) }),
        position: positionOf(at ? at.id : active.id),
        total: photos.length,
      }),
    );
  // dnd-kit's own live region is assertive and cannot be changed, so the Czech sentences go to the gallery's polite region.
  const silent: Announcements = {
    onDragStart: () => undefined,
    onDragOver: () => undefined,
    onDragEnd: () => undefined,
    onDragCancel: () => undefined,
  };

  return (
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
        props.onDrop(String(active.id), String(over.id));
      }}
      accessibility={{ announcements: silent, screenReaderInstructions: { draggable: cs.reorder.instructions } }}
    >
      <SortableContext items={shown.map((p) => p.id)} strategy={rectSortingStrategy}>
        <ul className="photo-grid" aria-label={cs.photos.gridLabel} aria-busy={busy}>
          {shown.map((photo) => (
            <Tile
              key={photo.id}
              photo={photo}
              position={positionOf(photo.id)}
              isCover={props.coverId === photo.id}
              isCategoryCover={props.categoryCoverId === photo.id}
              imgBase={props.imgBase}
              albumId={props.albumId}
              selecting={selecting}
              checked={props.selected.has(photo.id)}
              reorderable={reorderable && canMutate}
              busy={busy}
              deleteFailed={props.failedIds?.has(photo.id) ?? false}
              onToggle={props.onToggle}
              onLongPress={props.onLongPress}
              onMenu={props.onMenu}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}
