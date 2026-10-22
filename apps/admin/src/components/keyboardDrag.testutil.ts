/**
 * Test helper for the only way to reorder (T-243): the dnd-kit keyboard sensor on a drag handle.
 * jsdom has no layout, so every sortable row or tile gets a rectangle stacked in DOM order
 * (re-read on each call, so the rectangles follow the order after a move).
 */
import { screen } from '@testing-library/react';
import type userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

const SELECTOR = '[data-sortable-id], [data-photo-id]';

export function mockRowRects() {
  return vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const item = this.closest(SELECTOR) ?? (this.matches(SELECTOR) ? this : null);
    let top = 0;
    if (item?.parentElement) top = Array.from(item.parentElement.children).indexOf(item) * 100;
    return { x: 0, y: top, top, left: 0, right: 300, bottom: top + 80, width: 300, height: 80, toJSON: () => ({}) };
  });
}

/** Focuses the handle, lifts with Space, presses the arrow `steps` times (negative = up) and drops with Space. */
export async function keyboardDrag(
  user: ReturnType<typeof userEvent.setup>,
  handleName: string,
  steps: number,
) {
  const handle = screen.getByRole('button', { name: handleName });
  handle.focus();
  await user.keyboard(' ');
  const key = steps < 0 ? '{ArrowUp}' : '{ArrowDown}';
  for (let i = 0; i < Math.abs(steps); i += 1) await user.keyboard(key);
  await user.keyboard(' ');
}
