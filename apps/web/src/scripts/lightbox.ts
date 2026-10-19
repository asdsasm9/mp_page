/**
 * Album lightbox enhancement. Without this script every thumbnail is a plain link to the 1600 JPEG.
 * The native <dialog> (showModal) provides the focus trap, the inert background and Escape; this renders the state
 * from lightbox-state.ts, handles clicks and arrow keys, and hands the staged loading and zoom to lightbox-zoom.ts.
 * Nothing is requested before the lightbox is opened.
 */
import { close, focusIndex, hasNext, hasPrev, initial, keyAction, next, open, prev, type LightboxState } from './lightbox-state';
import { createZoom, photoInfoOf, prefetchFit, type CreateImage } from './lightbox-zoom';

const dialog = document.querySelector<HTMLDialogElement>('dialog[data-lightbox]');
const thumbs = [...document.querySelectorAll<HTMLAnchorElement>('a[data-lb-item]')];

if (dialog && thumbs.length && typeof dialog.showModal === 'function') {
  const part = <T extends HTMLElement>(name: string) => dialog.querySelector<T>(`[data-lb="${name}"]`)!;
  const img = part<HTMLImageElement>('img');
  const counter = part('count');
  const prevButton = part<HTMLButtonElement>('prev');
  const nextButton = part<HTMLButtonElement>('next');
  const create: CreateImage = () => new Image();
  const zoom = createZoom(
    {
      stage: part('stage'),
      front: img,
      back: part<HTMLImageElement>('back'),
      status: part('status'),
      group: part('zoom'),
      zoomIn: part('zoom-in'),
      zoomOut: part('zoom-out'),
      zoomFit: part('zoom-fit'),
    },
    { create },
  );
  let state: LightboxState = initial(thumbs.length);

  const show = (index: number): void => {
    const link = thumbs[index]!;
    const thumb = link.querySelector('img');
    img.alt = thumb?.alt ?? '';
    zoom.show(photoInfoOf(link), thumb?.currentSrc || thumb?.src || '');
    counter.textContent = `${index + 1} / ${thumbs.length}`;
    prevButton.disabled = !hasPrev(state);
    nextButton.disabled = !hasNext(state);
    // Neighbours: only the fit candidate, never a master, and nothing under Save-Data.
    const neighbours = [index - 1, index + 1].flatMap((n) => (thumbs[n] ? [photoInfoOf(thumbs[n]!)] : []));
    prefetchFit(create, neighbours, (navigator as Navigator & { connection?: { saveData?: boolean } }).connection);
  };

  const go = (to: LightboxState): void => {
    state = to;
    show(state.index);
  };

  thumbs.forEach((link, i) =>
    link.addEventListener('click', (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();
      state = open(initial(thumbs.length), i);
      dialog.showModal(); // first, so the stage can be measured by show()
      show(i);
    }),
  );

  prevButton.addEventListener('click', () => go(prev(state)));
  nextButton.addEventListener('click', () => go(next(state)));
  part('close').addEventListener('click', () => dialog.close());
  part('zoom-in').addEventListener('click', zoom.zoomIn);
  part('zoom-out').addEventListener('click', zoom.zoomOut);
  part('zoom-fit').addEventListener('click', zoom.zoomFit);
  part('stage').addEventListener('dblclick', (event) => zoom.toggleAt(event.clientX, event.clientY));
  window.addEventListener('resize', () => {
    if (dialog.open) zoom.refresh();
  });
  // A click on the backdrop lands on the dialog element itself.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('keydown', (event) => {
    if (zoom.handleKey(event)) {
      event.preventDefault();
      return;
    }
    const action = keyAction(event.key);
    if (action) go(action === 'next' ? next(state) : prev(state));
  });
  // Fires for Escape, the close button and the backdrop; focus goes back to the opening thumbnail.
  dialog.addEventListener('close', () => {
    const back = focusIndex(state);
    state = close(state);
    zoom.close();
    if (back !== null) thumbs[back]?.focus();
  });
}
