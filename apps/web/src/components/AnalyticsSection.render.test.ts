import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import { COOKIES } from '../content/texts';
import AnalyticsSection from './AnalyticsSection.astro';

async function render(enabled: boolean): Promise<string> {
  const container = await AstroContainer.create();
  return container.renderToString(AnalyticsSection, { props: { enabled } });
}

describe('AnalyticsSection.astro', () => {
  it('renders nothing without the beacon', async () => {
    const html = (await render(false)).trim();
    expect(html).toBe('');
  });

  it('renders the heading and the approved paragraph with the beacon', async () => {
    const html = await render(true);
    expect(html).toContain('<h2 id="mereni">Měření návštěvnosti</h2>');
    expect(html).toContain(COOKIES.ANALYTICS_PARAGRAPH);
  });
});

describe('COOKIES analytics text', () => {
  it('is conservative Czech: no EU, no placeholder, no cookie or storage claim to the contrary', () => {
    const text = COOKIES.ANALYTICS_PARAGRAPH;
    expect(text).not.toMatch(/\bEU\b|Evropsk|\[doplnit\]/);
    expect(text).toContain('Cloudflare Web Analytics');
    expect(text).toContain('nepoužívá cookies ani místní úložiště');
    for (const word of ['návštěvnost', 'oprávněný zájem', 'rychlost načtení']) expect(text).toContain(word);
  });

  it('leaves the controller placeholder untouched', () => {
    expect(COOKIES.controller.placeholder).toBe('[doplnit]');
  });

  it('keeps IČO optional: unset by default, never the placeholder', () => {
    expect(COOKIES.controller.companyId).toBeNull();
  });
});
