import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('admin stub', () => {
  it('renders Admin', () => {
    render(<App />);
    expect(screen.getByText('Admin')).toBeTruthy();
  });
});
