import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IconButton } from './IconButton';

afterEach(cleanup);

describe('IconButton', () => {
  it('names the button in Czech (aria-label and title) and hides the svg', () => {
    const onClick = vi.fn();
    render(<IconButton icon="trash" danger label="Smazat album: Svatby" onClick={onClick} />);
    const button = screen.getByRole('button', { name: 'Smazat album: Svatby' });
    expect(button.getAttribute('title')).toBe('Smazat album: Svatby');
    expect(button.textContent).toBe('');
    expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(button.className).toContain('button-icon-danger');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does not fire when disabled', () => {
    const onClick = vi.fn();
    render(<IconButton icon="edit" label="Upravit" disabled onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: 'Upravit' }));
    expect(onClick).not.toHaveBeenCalled();
  });
});
