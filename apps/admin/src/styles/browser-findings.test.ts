/**
 * Regression guards for what `npm run admin-check` (real Chrome) found in WP5-28. jsdom has no layout, so these
 * read the sources; the browser check itself proves the rendered result.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const css = read('./app.css');
const html = read('../../index.html');

describe('findings of the first real-browser run', () => {
  it('has an inline icon, so the browser does not request /favicon.ico (404 in the console)', () => {
    expect(html).toMatch(/<link rel="icon" href="data:/);
  });

  it('gives links that stand alone on a line, and list titles, a 44 px target', () => {
    const rule = css.match(/\.row-title,[^{]*\{[^}]*\}/)?.[0] ?? '';
    expect(rule).toContain('.page > p > a:only-child');
    expect(rule).toContain('.photo-side p > a:only-child');
    expect(rule).toContain('min-block-size: var(--target-min)');
    expect(rule).toContain('min-inline-size: var(--target-min)');
  });

  it('keeps short album names in the storage table at 44 px wide', () => {
    const rule = css.match(/\.data-table a \{[^}]*\}/)?.[0] ?? '';
    expect(rule).toContain('min-inline-size: var(--target-min)');
  });

  it('leaves room for the fixed upload queue so it never covers the last controls', () => {
    expect(css).toContain('.shell:has(.upload-drawer) .shell-main');
    expect(css).toMatch(/html:has\(\.upload-drawer\)\s*\{[^}]*scroll-padding-block-end/);
  });

  it('draws a chevron on summaries (display:flex removes the native marker)', () => {
    expect(css).toContain('.details summary::before');
    expect(css).toContain('.details[open] > summary::before');
  });

  it('keeps the desktop top bar on one row (no gap between the links, tight link padding)', () => {
    expect(css).toMatch(/\.desktop-nav \.nav-list\s*\{\s*gap: 0;/);
    expect(css).toMatch(/\.desktop-nav \.nav-link\s*\{\s*padding-inline: var\(--space-2\);/);
  });
});
