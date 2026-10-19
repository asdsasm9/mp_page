/**
 * Album lightbox enhancement. Without this script every thumbnail is a plain link to the 1600 JPEG.
 * The native <dialog> (showModal) provides the focus trap, the inert background and Escape; this only
 * renders the state from lightbox-state.ts and handles clicks and arrow keys.
 */
import { close, focusIndex, hasNext, hasPrev, initial, keyAction, next, open, prev, type LightboxState } from './lightbox-state';

const dialog = document.querySelector<HTMLDialogElement>('dialog[data-lightbox]');
const thumbs = [...document.querySelectorAll<HTMLAnchorElement>('a[data-lb-item]')];

if (dialog && thumbs.length && typeof dialog.showModal === 'function') {
  const part = <T extends HTMLElement>(name: string) => dialog.querySelector<T>(`[data-lb="${name}"]`)!;
  const img = part<HTMLImageElement>('img');
  const counter = part('count');
  const prevButton = part<HTMLButtonElement>('prev');
  const nextButton = part<HTMLButtonElement>('next');
  let state: LightboxState = initial(thumbs.length);

  const show = (index: number): void => {
    const link = thumbs[index]!;
    const thumb = link.querySelector('img');
    img.src = link.href;
    img.alt = thumb?.alt ?? '';
    if (thumb) {
      img.width = thumb.width;
      img.height = thumb.height;
    }
    counter.textContent = `${index + 1} / ${thumbs.length}`;
    prevButton.disabled = !hasPrev(state);
    nextButton.disabled = !hasNext(state);
    for (const n of [index - 1, index + 1]) if (thumbs[n]) new Image().src = thumbs[n]!.href;
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
      show(i);
      dialog.showModal();
    }),
  );

  prevButton.addEventListener('click', () => go(prev(state)));
  nextButton.addEventListener('click', () => go(next(state)));
  part('close').addEventListener('click', () => dialog.close());
  // A click on the backdrop lands on the dialog element itself.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('keydown', (event) => {
    const action = keyAction(event.key);
    if (action) go(action === 'next' ? next(state) : prev(state));
  });
  // Fires for Escape, the close button and the backdrop; focus goes back to the opening thumbnail.
  dialog.addEventListener('close', () => {
    const back = focusIndex(state);
    state = close(state);
    if (back !== null) thumbs[back]?.focus();
  });
}
