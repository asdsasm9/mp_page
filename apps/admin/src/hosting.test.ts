import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildHeaders } from '../headers';

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

  describe('_headers (WP5-29)', () => {
    const ENV = {
      VITE_SUPABASE_URL: 'https://abc.supabase.co/',
      VITE_API_BASE_URL: 'https://api.example.test/v1',
      VITE_IMG_BASE_URL: 'https://img.example.test/photos',
      VITE_PUBLIC_SITE_URL: 'https://www.example.test/',
      VITE_R2_UPLOAD_ORIGIN: 'https://bucket.r2.example.test',
    };

    /** Minimal `_headers` parser: unindented line = path pattern, indented `Name: value` lines belong to it. */
    function parse(text: string): Map<string, Map<string, string>> {
      const rules = new Map<string, Map<string, string>>();
      let cur: Map<string, string> | null = null;
      for (const line of text.split('\n')) {
        if (line.trim() === '' || line.trim().startsWith('#')) continue;
        if (!/^\s/.test(line)) {
          cur = new Map();
          rules.set(line.trim(), cur);
        } else if (cur) {
          const i = line.indexOf(':');
          cur.set(line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim());
        }
      }
      return rules;
    }

    const directives = (csp: string) => new Map(csp.split(';').map((d) => d.trim().split(/\s+/)).map(([name, ...v]) => [name!, v] as const));

    it('names the exact origins from the env in connect-src and img-src, nothing else', () => {
      const all = parse(buildHeaders(ENV).text).get('/*')!;
      const csp = directives(all.get('content-security-policy')!);
      expect(csp.get('connect-src')).toEqual([
        'https://abc.supabase.co',
        'https://api.example.test',
        'https://www.example.test',
        'https://bucket.r2.example.test',
      ]);
      expect(csp.get('img-src')).toEqual(["'self'", 'blob:', 'data:', 'https://img.example.test']);
      expect(csp.get('default-src')).toEqual(["'none'"]);
      expect(csp.get('script-src')).toEqual(["'self'"]);
      expect(csp.get('style-src')).toEqual(["'self'"]);
      expect(csp.get('frame-ancestors')).toEqual(["'none'"]);
    });

    it('has no wildcard and no unsafe-* anywhere in the policy', () => {
      const csp = buildHeaders(ENV).csp;
      expect(csp).not.toMatch(/\*/);
      expect(csp).not.toMatch(/unsafe-/);
      expect(csp).not.toMatch(/\bhttps?:(?!\/\/)/); // no bare scheme source such as https:
    });

    it('sets nosniff, no-referrer, noindex and no framing', () => {
      const all = parse(buildHeaders(ENV).text).get('/*')!;
      expect(all.get('x-content-type-options')).toBe('nosniff');
      expect(all.get('referrer-policy')).toBe('no-referrer');
      expect(all.get('x-robots-tag')).toMatch(/noindex/);
      expect(all.get('x-frame-options')).toBe('DENY');
    });

    it('caches hashed assets for a year and revalidates the HTML', () => {
      const rules = parse(buildHeaders(ENV).text);
      expect(rules.get('/assets/*')!.get('cache-control')).toBe('public, max-age=31536000, immutable');
      expect(rules.get('/index.html')!.get('cache-control')).toBe('no-cache');
    });

    it('without env origins the policy allows no connections at all', () => {
      const csp = directives(buildHeaders({}).csp);
      expect(csp.get('connect-src')).toEqual(["'none'"]);
      expect(csp.get('img-src')).toEqual(["'self'", 'blob:', 'data:']);
    });

    it('ignores values that are not http(s) URLs and de-duplicates origins', () => {
      const csp = directives(buildHeaders({ VITE_SUPABASE_URL: 'javascript:alert(1)', VITE_API_BASE_URL: 'https://a.test/x', VITE_PUBLIC_SITE_URL: 'https://a.test/y' }).csp);
      expect(csp.get('connect-src')).toEqual(['https://a.test']);
    });
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
