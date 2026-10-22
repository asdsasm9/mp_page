import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ICON_FILES, INITIAL_JS_GZIP_LIMIT, initialAssets, judgeBundle, judgeCsp, judgeDocumentHeaders, judgeIcons, judgeNoAnalytics } from './admin-prod-check-lib.mjs';

describe('admin-prod-check judges', () => {
  it('finds the initial script, modulepreloads and stylesheet in index.html', () => {
    const html = '<script type="module" crossorigin src="/assets/index-a.js"></script><link rel="modulepreload" crossorigin href="/assets/vendor-b.js"><link rel="stylesheet" crossorigin href="/assets/index-c.css">';
    expect(initialAssets(html)).toEqual({ js: ['/assets/index-a.js', '/assets/vendor-b.js'], css: ['/assets/index-c.css'] });
  });

  it('passes a bundle under budget and fails one over it', () => {
    const ok = judgeBundle([{ file: 'assets/index.js', raw: 500_000, gzip: 160_000, initial: true }, { file: 'assets/fake.js', raw: 1, gzip: 1, initial: false }]);
    expect(ok.failures).toEqual([]);
    expect(ok.totals.initialJsGzip).toBe(160_000);
    expect(ok.totals.jsGzip).toBe(160_001);
    const over = judgeBundle([{ file: 'assets/index.js', raw: 900_000, gzip: INITIAL_JS_GZIP_LIMIT, initial: true }]);
    expect(over.failures[0]).toMatch(/JS \d+ B gzip/);
    // a lazy chunk that is always fetched at start-up counts against the budget too
    const lazy = judgeBundle([{ file: 'assets/index.js', raw: 1, gzip: 200_000, initial: true }, { file: 'assets/real.js', raw: 1, gzip: 150_000, initial: false }]);
    expect(lazy.failures[0]).toMatch(/JS 350000 B gzip/);
    expect(judgeBundle([]).failures[0]).toMatch(/no script/);
  });

  it('requires the four icon links and files (T-248)', () => {
    const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'admin', 'index.html'), 'utf8');
    expect(judgeIcons(html, new Set(ICON_FILES))).toEqual([]);
    expect(judgeIcons(html, new Set(['favicon.svg']))).toHaveLength(3);
    expect(judgeIcons('<link rel="icon" href="data:image/svg+xml,x">', new Set(ICON_FILES)).length).toBe(5);
    for (const f of ICON_FILES) expect(existsSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'admin', 'public', f))).toBe(true);
  });

  it('requires a hardened CSP on the document', () => {
    const good = { 'content-security-policy': "default-src 'none'; frame-ancestors 'none'", 'x-robots-tag': 'noindex, nofollow' };
    expect(judgeDocumentHeaders(good)).toEqual([]);
    expect(judgeDocumentHeaders({})[0]).toMatch(/no Content-Security-Policy/);
    expect(judgeDocumentHeaders({ ...good, 'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; frame-ancestors 'none'" })[0]).toMatch(/unsafe/);
    expect(judgeDocumentHeaders({ ...good, 'content-security-policy': "connect-src https://x.test; frame-ancestors 'none'; img-src *" })[0]).toMatch(/wildcard/);
    expect(judgeDocumentHeaders({ ...good, 'content-security-policy': "default-src 'none'" })[0]).toMatch(/frame-ancestors/);
    expect(judgeDocumentHeaders({ ...good, 'x-robots-tag': '' })[0]).toMatch(/noindex/);
    const withGoogle = { ...good, 'content-security-policy': `${good['content-security-policy']}; connect-src https://accounts.google.com` };
    expect(judgeDocumentHeaders(withGoogle).join('\n')).toMatch(/must not mention google/);
  });

  it('fails when the admin dist carries the analytics beacon', () => {
    expect(judgeNoAnalytics([{ file: 'index.html', text: '<script src="/assets/a.js"></script>' }])).toEqual([]);
    for (const text of ['x="https://static.cloudflareinsights.com/"', '<script data-cf-beacon=\'{}\'>', 'import("beacon.min.js")']) {
      expect(judgeNoAnalytics([{ file: 'index.html', text }])[0]).toMatch(/index\.html references/);
    }
  });

  it('fails on an app violation, a refused allowed origin and an unenforced policy', () => {
    const probes = { allowed: [{ name: 'a', ok: true }], blocked: [{ name: 'b', directive: 'connect-src', seen: true }] };
    expect(judgeCsp([], probes)).toEqual([]);
    expect(judgeCsp([{ directive: 'style-src-attr', blocked: 'inline' }], probes)[0]).toMatch(/style-src-attr/);
    expect(judgeCsp([], { ...probes, allowed: [{ name: 'a', ok: false }] })[0]).toMatch(/refused/);
    expect(judgeCsp([], { ...probes, blocked: [{ name: 'b', directive: 'connect-src', seen: false }] })[0]).toMatch(/not enforced/);
  });
});
