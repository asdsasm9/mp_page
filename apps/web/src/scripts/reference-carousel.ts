/**
 * Reference carousel (progressive enhancement). The server HTML already shows slide 1 and lists the others;
 * without JavaScript (`@media (scripting: none)`) all slides are stacked. This script only moves the
 * `data-active` marker, keeps `inert`/`aria-hidden` on the hidden slides, updates the counter and handles
 * the buttons, Left/Right keys and a pointer swipe. No autoplay, so there is nothing to pause. The live region
 * is switched on after the first user interaction only, so nothing is announced on page load.
 */
import { apply, initial, keyAction, positionLabel, swipeAction, type CarouselState } from './carousel-state';

export function startCarousel(root: HTMLElement): void {
  const slides = [...root.querySelectorAll<HTMLElement>('[data-slide]')];
  const viewport = root.querySelector<HTMLElement>('[data-viewport]');
  const counter = root.querySelector<HTMLElement>('[data-counter]');
  if (slides.length < 2 || !viewport) return;

  let state: CarouselState = initial(slides.length);
  let interacted = false;

  const render = (): void => {
    slides.forEach((slide, i) => {
      const active = i === state.index;
      if (active) {
        slide.setAttribute('data-active', '');
        slide.removeAttribute('aria-hidden');
        slide.removeAttribute('inert');
      } else {
        slide.removeAttribute('data-active');
        slide.setAttribute('aria-hidden', 'true');
        slide.setAttribute('inert', '');
      }
    });
    if (counter) counter.textContent = positionLabel(state);
  };

  const step = (action: 'next' | 'prev' | null): void => {
    if (!action) return;
    if (!interacted) {
      interacted = true;
      viewport.setAttribute('aria-live', 'polite');
    }
    state = apply(state, action);
    render();
  };

  root.querySelector('[data-prev]')?.addEventListener('click', () => step('prev'));
  root.querySelector('[data-next]')?.addEventListener('click', () => step('next'));

  root.addEventListener('keydown', (event) => {
    const action = keyAction(event.key, {
      alt: event.altKey,
      ctrl: event.ctrlKey,
      meta: event.metaKey,
      shift: event.shiftKey,
    });
    if (!action) return;
    event.preventDefault();
    step(action);
  });

  // Swipe: touch and pen only (a mouse drag would fight text selection). touch-action: pan-y in the CSS keeps vertical scroll.
  let start: { x: number; y: number; id: number } | null = null;
  viewport.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' || !event.isPrimary) return;
    start = { x: event.clientX, y: event.clientY, id: event.pointerId };
  });
  viewport.addEventListener('pointerup', (event) => {
    if (!start || event.pointerId !== start.id) return;
    const action = swipeAction(event.clientX - start.x, event.clientY - start.y);
    start = null;
    step(action);
  });
  viewport.addEventListener('pointercancel', () => {
    start = null;
  });

  render();
}

for (const root of document.querySelectorAll<HTMLElement>('[data-carousel]')) startCarousel(root);
