import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// T-326: the hero is exactly the window tall (vh fallback, then svh, then dvh), never a min-height with a floor.
const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, 'Hero.astro'), 'utf8');
const screen = src.slice(src.indexOf('<style>'), src.indexOf('@media print'));

describe('Hero height', () => {
  it('is 100vh, then 100svh, then 100dvh in that order', () => {
    const vh = screen.indexOf('block-size: 100vh;');
    const svh = screen.indexOf('block-size: 100svh;');
    const dvh = screen.indexOf('block-size: 100dvh;');
    expect(vh).toBeGreaterThan(-1);
    expect(svh).toBeGreaterThan(vh);
    expect(dvh).toBeGreaterThan(svh);
  });

  it('has no fixed minimum above the window height', () => {
    expect(screen).not.toMatch(/min-block-size/);
    expect(screen).not.toContain('26rem');
  });

  it('keeps the image cropped to the box with the position token', () => {
    expect(screen).toMatch(/object-fit:\s*cover/);
    expect(screen).toContain('object-position: var(--hero-position)');
  });
});
