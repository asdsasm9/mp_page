import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cs } from '../i18n/cs';
import { encodeConcurrencyFor } from '../upload/queue';
import { LAPTOP_HINT_KEY } from '../upload/laptopHint';
import { LaptopHint } from './UploadDrawer';

function phone(matches: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches, media: query, addEventListener() {}, removeEventListener() {} }));
}

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('laptop hint (phone upload sheet)', () => {
  it('shows once on a phone, then never again after remount', () => {
    phone(true);
    const first = render(<LaptopHint />);
    expect(screen.getByText(cs.upload.laptopHint)).toBeTruthy();
    expect(window.localStorage.getItem(LAPTOP_HINT_KEY)).toBe('1');
    first.unmount();
    render(<LaptopHint />);
    expect(screen.queryByText(cs.upload.laptopHint)).toBeNull();
  });

  it('is not shown on a wide screen', () => {
    phone(false);
    render(<LaptopHint />);
    expect(screen.queryByText(cs.upload.laptopHint)).toBeNull();
    expect(window.localStorage.getItem(LAPTOP_HINT_KEY)).toBeNull();
  });

  it('survives storage that throws', () => {
    phone(true);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    render(<LaptopHint />);
    expect(screen.getByText(cs.upload.laptopHint)).toBeTruthy();
  });
});

describe('encode concurrency', () => {
  it('is 1 on a touch-primary pointer (one decode at a time) and 2 on desktop', () => {
    expect(encodeConcurrencyFor(true)).toBe(1);
    expect(encodeConcurrencyFor(false)).toBe(2);
  });
});
