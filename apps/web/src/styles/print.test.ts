import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// T-282: browsers do not print backgrounds, so light text on a dark band or on the hero scrim would vanish on paper.
const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8');

describe('print layer', () => {
  it('switches every dark-tone band to ink on paper with tokens only', () => {
    const base = read('styles/base.css');
    const print = base.slice(base.indexOf('@media print'));
    const block = /\[data-tone='dark'\]\s*\{([^}]*)\}/.exec(print)?.[1] ?? '';
    for (const name of ['--band-dark-bg', '--band-dark-text', '--band-dark-muted', '--band-dark-accent', '--color-on-overlay']) {
      expect(block, name).toContain(name);
    }
    expect(block).toContain('--band-dark-bg: transparent');
    expect(block).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });

  it('prints the hero photo above the text, not behind it', () => {
    const hero = read('components/sections/Hero.astro');
    const print = hero.slice(hero.indexOf('@media print'));
    expect(print).toMatch(/\.media\s*\{[^}]*position:\s*static/);
    expect(print).toMatch(/\.hero\s*\{[^}]*min-block-size:\s*0/);
  });

  it('prints all reviews and no carousel controls', () => {
    const ref = read('components/sections/Reference.astro');
    const print = ref.slice(ref.indexOf('@media print'));
    expect(print).toMatch(/\.controls\s*\{[^}]*display:\s*none/);
    expect(print).toMatch(/\.slide\s*\{[^}]*visibility:\s*visible/);
  });

  it('hides the header and the skip link', () => {
    expect(read('components/Header.astro')).toMatch(/@media print\s*\{\s*\.site-header\s*\{\s*display:\s*none/);
    expect(read('styles/base.css')).toMatch(/@media print[\s\S]*\.skip-link/);
  });
});
