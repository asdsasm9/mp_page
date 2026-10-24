// Render tests for the Reference carousel (T-278): server HTML for 0, 1 and N reviews and the no-JS / scripting CSS.
import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import { REVIEWS } from '../../content/reviews';
import type { HomeReview } from '../../lib/home';
import Reference from './Reference.astro';

const plain = (html: string): string => html.replace(/\sdata-astro-cid-[a-z0-9]+(="[^"]*")?/g, '');
const mk = (n: number): HomeReview[] =>
  Array.from({ length: n }, (_, i) => ({ review: REVIEWS[i % REVIEWS.length]!, categoryName: i === 1 ? null : 'Svatby' }));

async function render(reviews: HomeReview[]): Promise<string> {
  const container = await AstroContainer.create();
  return plain(await container.renderToString(Reference, { props: { reviews } }));
}

describe('Reference', () => {
  it('0 reviews renders nothing', async () => {
    const html = await render([]);
    expect(html).not.toContain('<section');
    expect(html).not.toContain('data-carousel');
  });

  it('1 review: no arrows, no counter, still a named slide', async () => {
    const html = await render(mk(1));
    expect(html).toContain('id="reference"');
    expect(html).toContain('aria-label="1 z 1"');
    expect(html).not.toContain('data-prev');
    expect(html).not.toContain('data-counter');
  });

  it('N reviews: slide 1 is active in the server HTML, others are not, with arrows and a counter', async () => {
    const html = await render(mk(3));
    expect(html).toContain('role="region" aria-roledescription="carousel" aria-label="Recenze klientů"');
    expect(html.match(/data-slide/g)).toHaveLength(3);
    expect(html.match(/data-active/g)).toHaveLength(1);
    expect(html).toMatch(/data-slide data-active[^>]*aria-label="1 z 3"/);
    expect(html).toContain('aria-label="Předchozí reference"');
    expect(html).toContain('aria-label="Další reference"');
    expect(html).toMatch(/data-counter>\s*1 \/ 3\s*</);
    expect(html).not.toContain('aria-live');
    expect(html).not.toContain('aria-hidden="true" inert');
  });

  it('shows the full review text as the quote, with no details or "Celá recenze"; name line copes with a missing category', async () => {
    const html = await render(mk(2));
    expect(html).toContain(`<p>${REVIEWS[0]!.text}</p>`);
    expect(html).toContain(`<p>${REVIEWS[1]!.text}</p>`);
    expect(html).not.toContain('<details');
    expect(html).not.toContain('Celá recenze');
    expect(html).toContain('Pati · Svatby');
    expect(html).toMatch(/>Anež</);
  });

  it('CSS: stacked without scripting, grid stack with it, fade only under no-preference, no autoplay', () => {
    const src = readFileSync(new URL('./Reference.astro', import.meta.url), 'utf8');
    const css = (/<style>([\s\S]*)<\/style>/.exec(src)?.[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(/@media \(scripting: none\)\s*{\s*\.controls\s*{\s*display: none/);
    expect(css).toMatch(/@media \(scripting: enabled\)[^{]*{[\s\S]*grid-area: 1 \/ 1/);
    expect(css).toMatch(/@media \(scripting: enabled\) and \(prefers-reduced-motion: no-preference\)[^{]*{[\s\S]*transition/);
    expect(css).toContain('touch-action: pan-y');
    const script = readFileSync(new URL('../../scripts/reference-carousel.ts', import.meta.url), 'utf8');
    expect(script).not.toMatch(/setInterval|setTimeout/);
  });
});
