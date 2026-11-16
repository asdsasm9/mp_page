/**
 * One tile of the Instagram planning grid (WP-14): the first photo of the post as the 480 px WebP (URL from the shared
 * key helper), cropped from the centre to 3:4. Planned and draft posts have a dashed outline and a text badge (colour
 * and line style are never the only signal); posted posts are solid. A carousel carries an icon and the photo count;
 * the link's accessible name is built from the visible text plus the hidden post name. Posts without photos show an
 * empty tile with a notice instead of an image. Open posts can be dragged by the 44 px handle; posted ones cannot.
 */
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { effectiveStatus, type IgPost } from '@mp/shared';
import { Link } from 'react-router-dom';
import { photoWebpUrl } from '../data/images';
import { cs } from '../i18n/cs';
import { fill, formatCount, formatPragueDateTime } from '../i18n/format';

const EXCERPT_MAX = 60;
/** The tile image is 480 px wide at 3:4 (grid-native 1080 x 1440). */
const IMG_WIDTH = 480;
const IMG_HEIGHT = 640;

export interface PostTileProps {
  post: IgPost;
  /** 1-based place in the grid. */
  position: number;
  imgBase: string;
  /** The next post to publish ("Další na řadě"). */
  isNext: boolean;
}

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

export function postName(position: number): string {
  return fill(cs.instagram.postName, { n: position });
}

function excerpt(caption: string): string {
  const chars = Array.from(caption.trim());
  return chars.length > EXCERPT_MAX ? `${chars.slice(0, EXCERPT_MAX).join('')}…` : chars.join('');
}

function firstPhotoId(post: IgPost): string | null {
  let best: IgPost['photos'][number] | null = null;
  for (const p of post.photos) if (!best || p.sort < best.sort) best = p;
  return best ? best.photo_id : null;
}

function TileLink({ post, position, imgBase, isNext }: PostTileProps) {
  const status = effectiveStatus(post);
  const photoId = firstPhotoId(post);
  const src = photoId ? photoWebpUrl(imgBase, photoId, 480) : null;
  const count = post.photos.length;
  const caption = excerpt(post.caption);
  const name = caption ? `${postName(position)}: ${caption}` : postName(position);
  const emptyText = post.status === 'posted' ? cs.instagram.photoDeleted : cs.instagram.noPhotos;

  return (
    <Link className="ig-link" to={`/instagram/${post.id}`}>
      {src ? (
        <img className="ig-img" src={src} width={IMG_WIDTH} height={IMG_HEIGHT} alt="" loading="lazy" decoding="async" />
      ) : (
        <span className="ig-empty">{emptyText}</span>
      )}
      <span className="visually-hidden">{name}</span>
      {count > 1 ? (
        <span className="ig-carousel">
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
            <rect x="5" y="2" width="9" height="9" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M3 5v8h8" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          <span aria-hidden="true">{count}</span>
          <span className="visually-hidden">{fill(cs.instagram.carousel, { photos: formatCount(count, cs.units.photo) })}</span>
        </span>
      ) : null}
      <span className="ig-badges">
        {status === 'posted' ? (
          <span className="visually-hidden">{fill(cs.instagram.postedOn, { date: formatPragueDateTime(post.posted_at ?? '').replace(/\s\d{2}:\d{2}$/, '') })}</span>
        ) : (
          <span className="ig-badge">{status === 'planned' ? cs.instagram.statusPlanned : cs.instagram.statusDraft}</span>
        )}
        {isNext ? <span className="ig-badge ig-badge-next">{cs.instagram.nextUp}</span> : null}
      </span>
    </Link>
  );
}

/** A posted tile: fixed place at the end of the grid, no handle. */
export function PostTile(props: PostTileProps) {
  return (
    <li className="ig-tile" data-ig-id={props.post.id} data-status="posted">
      <TileLink {...props} />
    </li>
  );
}

/** A planned or draft tile, sortable by its handle (mouse, 250 ms touch hold, keyboard). */
export function SortablePostTile(props: PostTileProps & { disabled: boolean }) {
  const { post, position, disabled } = props;
  const sortable = useSortable({
    id: post.id,
    disabled,
    attributes: { roleDescription: cs.reorder.roleDescription },
  });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: reducedMotion() ? undefined : sortable.transition,
  };
  return (
    <li
      ref={sortable.setNodeRef}
      style={style}
      className={sortable.isDragging ? 'ig-tile is-dragging' : 'ig-tile'}
      data-ig-id={post.id}
      data-sortable-id={post.id}
      data-status={effectiveStatus(post)}
    >
      <TileLink {...props} />
      <button
        type="button"
        ref={sortable.setActivatorNodeRef}
        className="photo-handle"
        aria-label={`${cs.reorder.handle}: ${postName(position)}`}
        disabled={disabled}
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
    </li>
  );
}
