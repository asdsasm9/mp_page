// Render tests for the Reference carousel (T-278): server HTML for 0, 1 and N reviews and the no-JS / scripting CSS.
import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import { SnapshotSchema, type SnapshotPhoto } from '@mp/shared';
import fixtureJson from '../../../../../packages/shared/fixtures/snapshot.fixture.json';
import { REVIEWS } from '../../content/reviews';
import type { HomeReview } from '../../lib/home';
import Reference from './Reference.astro';

const plain = (html: string): string => html.replace(/\sdata-astro-cid-[a-z0-9]+(="[^"]*")?/g, '');
const fixture = SnapshotSchema.parse(fixtureJson);
const portrait: SnapshotPhoto = fixture.categories[0]!.albums[0]!.photos[0]!;
const mk = (n: number, photo: SnapshotPhoto | null = null): HomeReview[] =>
  Array.from({ length: n }, (_, i) => ({ review: REVIEWS[i % REVIEWS.length]!, categoryName: i === 1 ? null : 'Svatby', photo }));

async function render(reviews: HomeReview[]): Promise<string> {
  const container = await AstroContainer.create();
  return plain(await container.renderToString(Reference, { props: { reviews, base: 'https://img.example.cz' } }));
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

  it('T-333: the author portrait follows the text inside the slide, lazy, one alt; no photo means no markup', async () => {
    const html = await render(mk(2, portrait));
    expect(html.match(/<picture/g)).toHaveLength(2);
    expect(html).toContain('alt="Pati, klientka"');
    expect(html).toContain('alt="Anež, klientka"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('crop-profile');
    expect(html.indexOf('</blockquote>')).toBeLessThan(html.indexOf('<picture'));
    expect(html.indexOf('</figcaption>')).toBeLessThan(html.indexOf('<picture'));
    const bare = await render(mk(2));
    expect(bare).not.toContain('<picture');
    expect(bare).not.toContain('class="portrait"');
  });

  it('CSS (T-333/T-335): phones centre caption and text block, desktop puts the portrait left, switcher centred', () => {
    const src = readFileSync(new URL('./Reference.astro', import.meta.url), 'utf8');
    const css = (/<style>([\s\S]*)<\/style>/.exec(src)?.[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(/figure\.has-photo blockquote,\s*\.slide figure\.has-photo figcaption \{\s*justify-self: center;\s*max-inline-size: 36rem;/);
    expect(css).toMatch(/figure\.has-photo figcaption \{\s*text-align: center;/);
    expect(css).toMatch(/grid-template-columns: auto minmax\(0, 36rem\);\s*grid-template-areas:\s*'portrait quote'\s*'portrait caption';/);
    expect(css).toMatch(/\.controls \{[^}]*justify-content: center/);
    expect(src).toContain('id="reference" class="fill fill-tall"');
    expect(src.indexOf('</blockquote>')).toBeLessThan(src.indexOf('class="portrait"'));
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
