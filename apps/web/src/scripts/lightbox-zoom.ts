/**
 * DOM side of the album lightbox: staged image loading and the zoom view. The math lives in
 * lightbox-zoom-state.ts, the open/close/index state in lightbox-state.ts; this file never touches the document at
 * import time, so the loader logic is unit-tested with injected fakes (lightbox-zoom.test.ts).
 *
 * Staging: open shows the grid thumbnail's already cached currentSrc in the back layer at once; the front image
 * loads the fit tier (data-lb-set, sizes 100vw) off screen and replaces the back layer after decode(); the master
 * (3000 px class) is requested by the first zoom action only, never for a neighbour. Nothing is requested before
 * the lightbox is opened.
 *
 * T-111 / T-112 extend the controller with wheel, pinch, drag pan, arrow-key pan and the zoom level announcement;
 * they reuse `act()` and `apply()`.
 */
import {
  canZoomIn,
  canZoomOut,
  clampView,
  fitSize,
  identity,
  isZoomed,
  maxScale,
  panBy,
  panStep,
  pinchMove,
  pinchStart,
  resetOnPhotoChange,
  settleView,
  toggleDoubleTap,
  wheelFactor,
  zoomAt,
  zoomEnabled,
  zoomPercent,
  zoomStep,
  type PinchStart,
  type Point,
  type Size,
  type ZoomGeometry,
  type ZoomView,
} from './lightbox-zoom-state';

export const STATUS_LOADING = 'Načítám plné rozlišení…';
export const STATUS_FAILED = 'Plné rozlišení se nepodařilo načíst, zobrazuje se menší verze.';
/** The lightbox shows the photo across the viewport width, so the fit tier is chosen against 100vw. */
export const FIT_SIZES = '100vw';

/** The slice of HTMLImageElement the loader needs (so tests can inject fakes). */
export interface ImageLike {
  src: string;
  srcset: string;
  sizes: string;
  readonly currentSrc: string;
  decode(): Promise<void>;
}

export type CreateImage = () => ImageLike;

export interface ImageRequest {
  src?: string;
  srcset?: string;
  sizes?: string;
}

/** Loads an image off screen and resolves once it is decoded; rejects when the file cannot be loaded or decoded. */
export async function loadDecoded(create: CreateImage, request: ImageRequest): Promise<ImageLike> {
  const image = create();
  // sizes and srcset before src, so the browser picks the candidate once.
  if (request.sizes !== undefined) image.sizes = request.sizes;
  if (request.srcset) image.srcset = request.srcset;
  if (request.src) image.src = request.src;
  await image.decode();
  return image;
}

/** Everything the lightbox knows about one photo (from the anchor's data-lb-* attributes). */
export interface PhotoInfo {
  /** srcset of the fit tiers (1600 / 2400 WebP). May be empty for odd data; then `href` is the fit source. */
  readonly fitSet: string;
  /** The 1600 JPEG that is also the no-JS link target. */
  readonly href: string;
  readonly masterUrl: string;
  readonly masterWidth: number;
  readonly masterHeight: number;
}

export function photoInfoOf(link: HTMLAnchorElement): PhotoInfo {
  const d = link.dataset;
  return {
    fitSet: d.lbSet ?? '',
    href: link.href,
    masterUrl: d.lbMaster ?? '',
    masterWidth: Number(d.lbMw),
    masterHeight: Number(d.lbMh),
  };
}

/** Loads the fit tier of a photo: the 1600/2400 candidates for 100vw, or the fallback JPEG without a set. */
export const loadFit = (create: CreateImage, photo: Pick<PhotoInfo, 'fitSet' | 'href'>): Promise<ImageLike> =>
  loadDecoded(create, photo.fitSet ? { srcset: photo.fitSet, sizes: FIT_SIZES } : { src: photo.href });

/** Holds at most one decoded master (they are ~36 MB decoded) and never requests the same URL twice. */
export function createMasterStore(create: CreateImage) {
  let url: string | null = null;
  let held: ImageLike | null = null;
  let pending: Promise<ImageLike> | null = null;
  return {
    has: (u: string): boolean => url === u && held !== null,
    /** The decoded master, or null when it cannot be loaded. A failed load may be retried by calling again. */
    request(u: string): Promise<ImageLike | null> {
      if (url !== u) {
        url = u;
        held = null;
        pending = null;
      }
      if (held) return Promise.resolve(held);
      if (!pending) {
        const p = loadDecoded(create, { src: u });
        pending = p;
        p.then(
          (image) => {
            if (pending === p) held = image;
          },
          () => {
            if (pending === p) pending = null;
          },
        );
      }
      return pending.then(
        (image) => image,
        () => null,
      );
    },
    /** Photo change: forget the master so its decoded pixels can be freed. */
    drop(): void {
      url = null;
      held = null;
      pending = null;
    },
  };
}

export interface ConnectionLike {
  readonly saveData?: boolean;
}

/**
 * Warms the cache with the fit candidate (never the master) of the given neighbours. Does nothing under saveData.
 * Returns the images it started, which tests inspect.
 */
export function prefetchFit(
  create: CreateImage,
  neighbours: readonly Pick<PhotoInfo, 'fitSet' | 'href'>[],
  connection?: ConnectionLike,
): ImageLike[] {
  if (connection?.saveData) return [];
  return neighbours.map((photo) => {
    const image = create();
    if (photo.fitSet) {
      image.sizes = FIT_SIZES;
      image.srcset = photo.fitSet;
    } else {
      image.src = photo.href;
    }
    return image;
  });
}

export const LEVEL_DELAY_MS = 250;
export const zoomLevelText = (percent: number): string => `Přiblížení ${percent} %`;

export type ZoomKey = 'in' | 'out' | 'fit';

/** +, - and 0 (also = and the numpad forms); modified keys belong to the browser's own page zoom. */
export function zoomKeyAction(event: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): ZoomKey | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (event.key === '+' || event.key === '=') return 'in';
  if (event.key === '-' || event.key === '_') return 'out';
  if (event.key === '0') return 'fit';
  return null;
}

/** The elements the controller drives; HTMLElements in the page, plain objects in the unit tests. */
export interface ZoomParts {
  stage: HTMLElement;
  front: HTMLImageElement;
  back: HTMLImageElement;
  status: HTMLElement;
  group: HTMLElement;
  zoomIn: HTMLElement;
  zoomOut: HTMLElement;
  zoomFit: HTMLElement;
  /** Visually hidden polite live region for "Přiblížení 150 %"; optional so older fakes still work. */
  level?: HTMLElement;
}

export interface ZoomOptions {
  create: CreateImage;
  /** Where the double click happened relative to the stage centre; injectable for tests. */
  stageCentre?: (parts: ZoomParts) => Point;
}

export function createZoom(parts: ZoomParts, options: ZoomOptions) {
  const { stage, front, back, status, group } = parts;
  const store = createMasterStore(options.create);
  let photo: PhotoInfo | null = null;
  let view: ZoomView = identity;
  let masterShown = false;
  let masterLoading = false;
  /** Bumped on every photo change, close and reset; a late decode of an older photo is ignored. */
  let epoch = 0;
  let pinch: PinchStart | null = null;
  let announced = 100;
  let levelTimer: ReturnType<typeof setTimeout> | undefined;

  /** The rendered image box (CSS px, before the transform) and the stage; the photo is contained in the box. */
  function geometry(): ZoomGeometry | null {
    if (!photo) return null;
    const stageSize: Size = { width: stage.clientWidth, height: stage.clientHeight };
    const box: Size =
      front.offsetWidth > 0 && front.offsetHeight > 0
        ? { width: front.offsetWidth, height: front.offsetHeight }
        : stageSize;
    const fit = fitSize(box, { width: photo.masterWidth, height: photo.masterHeight });
    return { stage: stageSize, fit, max: maxScale(photo.masterWidth, fit.width) };
  }

  const setDisabled = (el: HTMLElement, disabled: boolean): void => {
    // aria-disabled keeps the button focusable, so keyboard focus is not lost when the limit is reached.
    el.setAttribute('aria-disabled', String(disabled));
  };

  function apply(): void {
    const g = geometry();
    stage.style.setProperty('--lb-scale', String(view.scale));
    stage.style.setProperty('--lb-x', `${view.x}px`);
    stage.style.setProperty('--lb-y', `${view.y}px`);
    stage.toggleAttribute('data-zoomed', isZoomed(view));
    setDisabled(parts.zoomIn, !g || !canZoomIn(view, g));
    setDisabled(parts.zoomOut, !canZoomOut(view));
    setDisabled(parts.zoomFit, !isZoomed(view));
  }

  /** Re-measures: shows the zoom group and data-zoom='on' only when the master gives enough headroom. */
  function refresh(): void {
    const g = geometry();
    const on = g !== null && zoomEnabled(g.max);
    group.hidden = !on;
    if (on) stage.setAttribute('data-zoom', 'on');
    else stage.removeAttribute('data-zoom');
    view = on ? clampView(view, g) : identity;
    apply();
  }

  async function showMaster(): Promise<void> {
    if (!photo || masterShown || masterLoading || !photo.masterUrl) return;
    const mine = photo;
    const turn = epoch;
    if (!store.has(mine.masterUrl)) status.textContent = STATUS_LOADING;
    masterLoading = true;
    const image = await store.request(mine.masterUrl);
    if (turn !== epoch) return; // another photo or a close happened meanwhile
    masterLoading = false;
    if (!image) {
      status.textContent = STATUS_FAILED; // keep the fit view; zoom still works on what is loaded
      return;
    }
    front.removeAttribute('srcset');
    front.src = image.currentSrc || image.src;
    masterShown = true;
    status.textContent = '';
  }

  /** Runs a zoom change; any result above fit triggers the one master request. */
  function act(change: (g: ZoomGeometry) => ZoomView): void {
    const g = geometry();
    if (!g || !zoomEnabled(g.max)) return;
    view = change(g);
    apply();
    announce();
    if (isZoomed(view)) void showMaster();
  }

  /** Polite zoom level text, debounced so a pinch or a key repeat is read once, and only when the level changed. */
  function announce(): void {
    if (!parts.level) return;
    if (levelTimer !== undefined) clearTimeout(levelTimer);
    levelTimer = setTimeout(() => {
      levelTimer = undefined;
      const percent = zoomPercent(view);
      if (percent === announced || !parts.level) return;
      announced = percent;
      parts.level.textContent = zoomLevelText(percent);
    }, LEVEL_DELAY_MS);
  }

  const toStage = (p: Point): Point => {
    const c = (options.stageCentre ?? defaultCentre)(parts);
    return { x: p.x - c.x, y: p.y - c.y };
  };

  function reset(): void {
    if (levelTimer !== undefined) clearTimeout(levelTimer);
    levelTimer = undefined;
    announced = 100;
    pinch = null;
    if (parts.level) parts.level.textContent = '';
    epoch += 1;
    view = resetOnPhotoChange();
    masterShown = false;
    masterLoading = false;
    status.textContent = '';
    apply();
  }

  const api = {
    /** Staged display of one photo. Call after the dialog is open, so the stage can be measured. */
    show(next: PhotoInfo, thumbSrc: string): void {
      if (photo && photo.masterUrl !== next.masterUrl) store.drop();
      photo = next;
      reset();
      const turn = epoch;
      if (thumbSrc) {
        back.src = thumbSrc;
        back.hidden = false;
      } else {
        back.hidden = true;
      }
      front.removeAttribute('srcset');
      front.removeAttribute('src');
      refresh();
      const place = (image: ImageLike | null): void => {
        if (turn !== epoch) return;
        front.removeAttribute('srcset');
        front.src = image ? image.currentSrc || image.src : next.href;
        back.hidden = true;
        refresh();
      };
      loadFit(options.create, next).then(place, () => place(null));
    },
    /**
     * Dialog closed: back to fit, status cleared, and the decoded master is dropped to free phone memory.
     * A reopen asks for it again on the first zoom; masters are served with immutable cache headers, so the
     * browser's HTTP cache answers.
     */
    close(): void {
      store.drop();
      reset();
      refresh();
    },
    refresh,
    zoomIn: () => act((g) => zoomStep(view, 1, g)),
    zoomOut: () => act((g) => zoomStep(view, -1, g)),
    zoomFit: () => act(() => identity),
    /** Double click: back to fit when zoomed, else 2x (or max) around the pointer. */
    toggleAt(clientX: number, clientY: number): void {
      const c = (options.stageCentre ?? defaultCentre)(parts);
      act((g) => toggleDoubleTap(view, { x: clientX - c.x, y: clientY - c.y }, g));
    },
    /** Whether zoom is offered for this photo (the master has headroom). */
    get enabled(): boolean {
      const g = geometry();
      return g !== null && zoomEnabled(g.max);
    },
    get zoomed(): boolean {
      return isZoomed(view);
    },
    /** Pinch begin: the two pointers in client coordinates. */
    pinchBegin(a: Point, b: Point): void {
      pinch = pinchStart(view, toStage(a), toStage(b));
    },
    /** Pinch update: scale follows the distance ratio, the midpoint pans. */
    pinchTo(a: Point, b: Point): void {
      const start = pinch;
      if (!start) return;
      act((g) => pinchMove(start, toStage(a), toStage(b), g));
    },
    /** Pinch end: a scale within 5 % of fit snaps to exactly fit. */
    pinchEnd(): void {
      pinch = null;
      if (view.scale > 1 && settleView(view) === identity) {
        view = identity;
        apply();
        announce();
      }
    },
    /** Drag pan by a client-pixel delta (does nothing at fit). */
    panByPx(dx: number, dy: number): void {
      act((g) => (view.scale > 1 ? panBy(view, dx, dy, g) : view));
    },
    /** ctrl+wheel (trackpad pinch): zoom around the pointer. */
    wheelAt(deltaY: number, deltaMode: number, clientX: number, clientY: number): void {
      act((g) => zoomAt(view, view.scale * wheelFactor(deltaY, deltaMode), toStage({ x: clientX, y: clientY }), g));
    },
    /** Arrow keys pan while zoomed; returns true when it consumed the key (otherwise the arrows change photo). */
    handlePanKey(event: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): boolean {
      if (!isZoomed(view) || event.ctrlKey || event.metaKey || event.altKey) return false;
      const g = geometry();
      if (!g) return false;
      const step = panStep(g.stage);
      // Arrow right shows more of the right side, so the image moves left.
      const d: Record<string, [number, number]> = {
        ArrowLeft: [step, 0],
        ArrowRight: [-step, 0],
        ArrowUp: [0, step],
        ArrowDown: [0, -step],
      };
      const delta = d[event.key];
      if (!delta) return false;
      act((geo) => panBy(view, delta[0], delta[1], geo));
      return true;
    },
    /** Handles +, - and 0; returns true when the key was a zoom key (the caller then prevents the default). */
    handleKey(event: Parameters<typeof zoomKeyAction>[0]): boolean {
      const key = zoomKeyAction(event);
      if (!key) return false;
      if (key === 'in') api.zoomIn();
      else if (key === 'out') api.zoomOut();
      else api.zoomFit();
      return true;
    },
    get view(): ZoomView {
      return view;
    },
  };
  return api;
}

function defaultCentre(parts: ZoomParts): Point {
  const r = parts.stage.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
