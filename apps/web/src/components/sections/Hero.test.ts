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

  it('T-327: centres the text block, caps its width at 60rem and balances the h1', () => {
    expect(screen).toMatch(/justify-items:\s*center/);
    expect(screen).toMatch(/text-align:\s*center/);
    expect(screen).toContain('min(60rem, 100%)');
    expect(screen).toContain('text-wrap: balance');
    expect(src).toContain('{HERO_TITLE}');
  });

  it('keeps the image cropped to the box with the position token', () => {
    expect(screen).toMatch(/object-fit:\s*cover/);
    expect(screen).toContain('object-position: var(--hero-position)');
  });

  it('T-338: the img fills the box and out-ranks Photo.astro `.photo img { block-size: auto }`', () => {
    expect(screen).toMatch(/\.media :global\(picture\.photo img\)/);
    expect(screen).toMatch(/\.media :global\(picture\)\s*\{[^}]*display:\s*block[^}]*block-size:\s*100%/);
    const rule = screen.slice(screen.indexOf('.media :global(img)'), screen.indexOf('/* Reads as'));
    expect(rule).toMatch(/inline-size:\s*100%/);
    expect(rule).toMatch(/block-size:\s*100%/);
    expect(rule).not.toMatch(/block-size:\s*auto|aspect-ratio|height:\s*auto/);
  });

  it('T-338: the home page passes a hero `sizes` built from the photo aspect ratio', () => {
    const page = readFileSync(join(here, '../../pages/index.astro'), 'utf8');
    expect(page).toContain('heroSizes(chosenHero.photo.variants.jpeg.w, chosenHero.photo.variants.jpeg.h)');
    expect(page).toContain('heroSizes(hero.width, hero.height)');
    expect(page).not.toContain('context="hero"');
  });
});
