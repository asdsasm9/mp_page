import { describe, expect, it } from 'vitest';
import { buildCsp, buildHeaders, cspOfHeaders } from './headers';

// Golden output captured before WP-7 (no analytics flag). Must never change.
const GOLDEN_PLAIN =
  "default-src 'self'; img-src 'self' data:; font-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'";
const GOLDEN_FULL =
  "default-src 'self'; img-src 'self' https://img.mullnyphotos.cz data:; font-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; script-src 'self' 'sha256-AAA='; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'";

describe('buildCsp analytics flag', () => {
  it('is byte-identical to the golden output with the flag absent or false', () => {
    expect(buildCsp()).toBe(GOLDEN_PLAIN);
    expect(buildCsp({ analytics: false })).toBe(GOLDEN_PLAIN);
    const opts = { imgOrigin: 'https://img.mullnyphotos.cz', scriptHashes: ['sha256-AAA='] };
    expect(buildCsp(opts)).toBe(GOLDEN_FULL);
    expect(buildCsp({ ...opts, analytics: false })).toBe(GOLDEN_FULL);
  });

  it('adds exactly the two Cloudflare hosts when true, nothing else', () => {
    const csp = buildCsp({ analytics: true, scriptHashes: ['sha256-AAA='] });
    expect(csp).toContain("script-src 'self' 'sha256-AAA=' https://static.cloudflareinsights.com;");
    expect(csp).toContain("connect-src 'self' https://cloudflareinsights.com;");
    expect(csp).not.toContain('*');
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp.match(/'unsafe-inline'/g)).toHaveLength(1); // only style-src-attr
    // every other directive unchanged
    const without = (s: string) => s.split('; ').filter((d) => !/^(script|connect)-src/.test(d));
    expect(without(csp)).toEqual(without(buildCsp({ scriptHashes: ['sha256-AAA='] })));
  });

  it('reaches the _headers text and not the flag-less one', () => {
    const on = cspOfHeaders(buildHeaders({ noindex: false, analytics: true }));
    const off = cspOfHeaders(buildHeaders({ noindex: false }));
    expect(on).toContain('https://static.cloudflareinsights.com');
    expect(on).toContain('https://cloudflareinsights.com');
    expect(off).toBe(GOLDEN_PLAIN);
  });
});
