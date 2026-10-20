import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

describe('hosting files', () => {
  it('index.html is Czech and noindex', () => {
    const html = read('../index.html');
    expect(html).toContain('<html lang="cs">');
    expect(html).toMatch(/<meta name="robots" content="noindex/);
  });

  it('_redirects has the SPA fallback', () => {
    expect(read('../public/_redirects')).toMatch(/^\/\*\s+\/index\.html\s+200$/m);
  });

  it('package.json pins every dependency exactly', () => {
    const pkg = JSON.parse(read('../package.json')) as Record<string, Record<string, string>>;
    for (const group of ['dependencies', 'devDependencies']) {
      for (const [name, v] of Object.entries(pkg[group] ?? {})) {
        expect(v, name).not.toMatch(/[\^~]/);
      }
    }
  });
});
