import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Modal } from './Modal';

afterEach(cleanup);

describe('Modal dismissible', () => {
  it('Escape and cancel call onClose by default', () => {
    const onClose = vi.fn();
    render(
      <Modal title="T" onClose={onClose}>
        <button type="button">ok</button>
      </Modal>,
    );
    fireEvent.keyDown(screen.getByRole('button', { name: 'ok' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores Escape and cancel when dismissible is false', () => {
    const onClose = vi.fn();
    render(
      <Modal title="T" onClose={onClose} dismissible={false}>
        <button type="button">ok</button>
      </Modal>,
    );
    const dialog = document.querySelector('dialog')!;
    fireEvent.keyDown(screen.getByRole('button', { name: 'ok' }), { key: 'Escape' });
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog.hasAttribute('open')).toBe(true);
  });
});
