import { describe, expect, it } from 'vitest';
import { BEACON_SRC } from './beacon';
import { HASH_REDIRECT_SCRIPT } from './hash-redirect';
import { buildHeaders } from './headers';
import { checkAnalyticsOutput, collectScriptHashes } from './postbuild';

const TOKEN = 'a'.repeat(32);
// As Astro renders it: double-quoted attributes, entity-escaped JSON.
const BEACON = `<script type="module" src="${BEACON_SRC}" data-cf-beacon="{&quot;token&quot;:&quot;${TOKEN}&quot;}"></script>`;
const page = (extra = '') => `<!doctype html><html><head><script>${HASH_REDIRECT_SCRIPT}</script>${extra}</head><body></body></html>`;

const headersOn = buildHeaders({ noindex: false, analytics: true });
const headersOff = buildHeaders({ noindex: false });

describe('collectScriptHashes and the external beacon tag', () => {
  it('ignores the beacon tag (external script, no hash)', () => {
    const withBeacon = collectScriptHashes([{ path: 'index.html', html: page(BEACON) }]);
    expect(withBeacon).toEqual(collectScriptHashes([{ path: 'index.html', html: page() }]));
    expect(withBeacon).toHaveLength(1);
  });
});

describe('checkAnalyticsOutput', () => {
  const ok = [{ path: 'index.html', html: page(BEACON) }, { path: 'cookies/index.html', html: page(BEACON) }];

  it('is green with a token, one beacon per page and both CSP hosts', () => {
    expect(checkAnalyticsOutput({ pages: ok, headersText: headersOn, token: TOKEN })).toEqual([]);
  });

  it('is green token-less with no beacon and the plain CSP', () => {
    const pages = [{ path: 'index.html', html: page() }];
    expect(checkAnalyticsOutput({ pages, headersText: headersOff, token: null })).toEqual([]);
  });

  it('fails token-less when a beacon or host is present', () => {
    expect(checkAnalyticsOutput({ pages: ok, headersText: headersOff, token: null })).not.toEqual([]);
    expect(checkAnalyticsOutput({ pages: [{ path: 'a.html', html: page() }], headersText: headersOn, token: null })).not.toEqual([]);
  });

  it('fails on two beacon tags', () => {
    const pages = [{ path: 'index.html', html: page(BEACON + BEACON) }];
    const errors = checkAnalyticsOutput({ pages, headersText: headersOn, token: TOKEN });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join()).toContain('exactly one');
  });

  it('fails with a token and zero pages', () => {
    const errors = checkAnalyticsOutput({ pages: [], headersText: headersOn, token: TOKEN });
    expect(errors.join()).toContain('no html pages');
    expect(checkAnalyticsOutput({ pages: [], headersText: headersOff, token: null })).toEqual([]);
  });

  it('with a token flags a non-script beacon reference next to the one expected tag', () => {
    for (const extra of [
      `<link rel="preload" href="${BEACON_SRC}" as="script">`,
      '<img src="https://static.cloudflareinsights.com/x.png" alt="">',
      '<p>data-cf-beacon</p>',
    ]) {
      const errors = checkAnalyticsOutput({ pages: [{ path: 'index.html', html: page(BEACON + extra) }], headersText: headersOn, token: TOKEN });
      expect(errors.join()).toContain('outside the one expected beacon tag');
    }
  });

  it('fails on a page without a beacon', () => {
    const pages = [{ path: 'index.html', html: page() }];
    expect(checkAnalyticsOutput({ pages, headersText: headersOn, token: TOKEN })).not.toEqual([]);
  });

  it('fails when the CSP lacks the beacon hosts', () => {
    const errors = checkAnalyticsOutput({ pages: ok, headersText: headersOff, token: TOKEN });
    expect(errors.join()).toContain('script-src');
    expect(errors.join()).toContain('connect-src');
  });

  it('fails on a wrong token or src', () => {
    const wrong = BEACON.replace(TOKEN, 'b'.repeat(32));
    expect(checkAnalyticsOutput({ pages: [{ path: 'i.html', html: page(wrong) }], headersText: headersOn, token: TOKEN })).not.toEqual([]);
    const other = BEACON.replace(BEACON_SRC, 'https://static.cloudflareinsights.com/other.js');
    expect(checkAnalyticsOutput({ pages: [{ path: 'i.html', html: page(other) }], headersText: headersOn, token: TOKEN })).not.toEqual([]);
  });

  it('fails on a gtag( string, inline or in own JS', () => {
    const inline = [{ path: 'index.html', html: page(`${BEACON}<script>gtag('js', new Date())</script>`) }];
    expect(checkAnalyticsOutput({ pages: inline, headersText: headersOn, token: TOKEN })).not.toEqual([]);
    const scripts = [{ path: '_astro/x.js', text: 'window.gtag("config")' }];
    expect(checkAnalyticsOutput({ pages: ok, headersText: headersOn, token: TOKEN, scripts })).not.toEqual([]);
  });

  it('fails on document.cookie, localStorage, sessionStorage in own JS or inline', () => {
    for (const text of ['document.cookie="a=1"', 'localStorage.setItem("a","b")', 'sessionStorage.x']) {
      const scripts = [{ path: '_astro/x.js', text }];
      expect(checkAnalyticsOutput({ pages: ok, headersText: headersOn, token: TOKEN, scripts })).not.toEqual([]);
      const inline = [{ path: 'index.html', html: page(`${BEACON}<script>${text}</script>`) }];
      expect(checkAnalyticsOutput({ pages: inline, headersText: headersOn, token: TOKEN })).not.toEqual([]);
    }
  });

  it('lets the hash redirect and ordinary own JS pass', () => {
    const scripts = [{ path: '_astro/menu.js', text: 'document.querySelector("a").focus()' }];
    expect(checkAnalyticsOutput({ pages: ok, headersText: headersOn, token: TOKEN, scripts })).toEqual([]);
  });
});
