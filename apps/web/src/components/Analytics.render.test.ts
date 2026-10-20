import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import Analytics from './Analytics.astro';

const token = 'TestToken1234abcd';

async function render(value: string | null): Promise<string> {
  const container = await AstroContainer.create();
  return container.renderToString(Analytics, { props: { token: value } });
}

describe('Analytics.astro', () => {
  it('renders no trace of the beacon without a token', async () => {
    const html = await render(null);
    expect(html).not.toMatch(/beacon|cloudflare|<script/i);
  });

  it('renders exactly one module script with the parseable config', async () => {
    const html = await render(token);
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html).toContain('type="module"');
    expect(html).toContain('src="https://static.cloudflareinsights.com/beacon.min.js"');
    expect(html).not.toContain('defer');
    const raw = /data-cf-beacon=(["'])(.*?)\1/s.exec(html)?.[2] ?? '';
    const unescaped = raw
      .replaceAll('&quot;', '"')
      .replaceAll('&#39;', "'")
      .replaceAll('&amp;', '&');
    expect(JSON.parse(unescaped)).toEqual({ token });
  });
});
