import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { HASH_REDIRECT_SCRIPT } from './hash-redirect';
import { buildCsp, buildHeaders, cspOfHeaders } from './headers';
import { SITE_ORIGIN } from './jsonld';
import {
  PostbuildError,
  collectScriptHashes,
  inlineScripts,
  missingScriptHashes,
  ogImagePathOf,
  scriptHash,
} from './postbuild';
import { buildPublishJson } from './publish-json';

const HOME = `<!doctype html><html><head>
<meta property="og:image" content="${SITE_ORIGIN}/_astro/main.abc.jpg">
<script type="application/ld+json">{"@type":"Person"}</script>
<script>${HASH_REDIRECT_SCRIPT}</script>
<script type="module" src="/_astro/menu.js"></script>
</head><body></body></html>`;
const pages = [{ path: 'index.html', html: HOME }];

describe('inline scripts', () => {
  it('finds only executable inline scripts (no JSON-LD, no src)', () => {
    expect(inlineScripts(HOME)).toEqual([HASH_REDIRECT_SCRIPT]);
  });

  it('hashes the exact text as sha256 base64', () => {
    const expected = createHash('sha256').update(HASH_REDIRECT_SCRIPT).digest('base64');
    expect(scriptHash(HASH_REDIRECT_SCRIPT)).toBe(`sha256-${expected}`);
    expect(collectScriptHashes(pages)).toEqual([`sha256-${expected}`]);
  });

  it('deduplicates the same script on several pages', () => {
    expect(collectScriptHashes([...pages, { path: 'x/index.html', html: HOME }])).toHaveLength(1);
  });
});

describe('CSP coverage check', () => {
  const hashes = collectScriptHashes(pages);

  it('is green when the hash is in script-src', () => {
    expect(missingScriptHashes(pages, buildCsp({ scriptHashes: hashes }))).toEqual([]);
  });

  it('is red when the hash of the home script is removed', () => {
    const missing = missingScriptHashes(pages, buildCsp({ scriptHashes: [] }));
    expect(missing).toEqual([{ path: 'index.html', hash: hashes[0]! }]);
  });

  it('is red when the script changed after hashing', () => {
    const changed = [{ path: 'index.html', html: HOME.replace('location.replace', 'location.assign') }];
    expect(missingScriptHashes(changed, buildCsp({ scriptHashes: hashes }))).toHaveLength(1);
  });

  it('works on the text read back from _headers', () => {
    const text = buildHeaders({ noindex: false, scriptHashes: hashes });
    expect(missingScriptHashes(pages, cspOfHeaders(text)!)).toEqual([]);
  });
});

describe('og image', () => {
  it('returns the path of a site-origin image', () => {
    expect(ogImagePathOf(HOME)).toBe('/_astro/main.abc.jpg');
  });

  it('throws when missing or on a foreign host', () => {
    expect(() => ogImagePathOf('<html></html>')).toThrow(PostbuildError);
    expect(() => ogImagePathOf('<meta property="og:image" content="https://evil.example/a.jpg">')).toThrow(PostbuildError);
  });
});

describe('_headers', () => {
  const csp = buildCsp({ imgOrigin: 'https://img.mullnyphotos.cz', scriptHashes: ['sha256-AAA='] });

  it('builds the strict CSP', () => {
    expect(csp).toBe(
      "default-src 'self'; img-src 'self' https://img.mullnyphotos.cz data:; font-src 'self'; style-src 'self'; " +
        "style-src-attr 'unsafe-inline'; script-src 'self' 'sha256-AAA='; connect-src 'self'; base-uri 'none'; " +
        "form-action 'none'; frame-ancestors 'none'; object-src 'none'",
    );
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  });

  it('lists a relative or same-origin image base only once as self', () => {
    expect(buildCsp({ imgOrigin: '/_dev-img' })).toContain("img-src 'self' data:");
  });

  it('adds noindex outside production only', () => {
    expect(buildHeaders({ noindex: true })).toContain('X-Robots-Tag: noindex, nofollow');
    expect(buildHeaders({ noindex: false })).not.toContain('X-Robots-Tag');
  });

  it('sets nosniff, referrer, permissions and the cache rules', () => {
    const t = buildHeaders({ noindex: false });
    expect(t).toContain('X-Content-Type-Options: nosniff');
    expect(t).toContain('Referrer-Policy: strict-origin-when-cross-origin');
    expect(t).toContain('Permissions-Policy: camera=(), microphone=(), geolocation=()');
    expect(t).toContain('/_astro/*\n  ! Cache-Control\n  Cache-Control: public, max-age=31536000, immutable');
    expect(t).toContain('/_publish.json\n  ! Cache-Control\n  Cache-Control: no-store\n  Access-Control-Allow-Origin: *');
  });
});

describe('_publish.json', () => {
  it('carries the snapshot timestamp, not the build time', () => {
    const snap = { generatedAt: '2026-10-19T10:00:00.000Z', counts: { categories: 1, albums: 2, photos: 3 } };
    const json = buildPublishJson(snap, { siteEnv: 'preview', source: 'snapshot' }, new Date('2026-10-19T11:00:00Z'));
    expect(json).toEqual({
      schemaVersion: 1,
      snapshotGeneratedAt: '2026-10-19T10:00:00.000Z',
      builtAt: '2026-10-19T11:00:00.000Z',
      counts: { categories: 1, albums: 2, photos: 3 },
      siteEnv: 'preview',
      source: 'snapshot',
    });
  });
});
