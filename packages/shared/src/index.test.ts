import { describe, expect, it } from 'vitest';
import { SHARED_VERSION } from './index';

describe('@mp/shared smoke', () => {
  it('exports SHARED_VERSION', () => {
    expect(SHARED_VERSION).toBe(1);
  });
});
