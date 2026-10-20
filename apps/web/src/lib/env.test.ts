import { describe, expect, it } from 'vitest';
import { BuildConfigError, DEV_IMG_BASE, assertProductionOutput, resolveEnv } from './env';

const SNAP = 'https://img.example.cz/catalog/published.json';
const IMG = 'https://img.example.cz/';

describe('resolveEnv', () => {
  it('defaults to fixture mode, dev image base and noindex', () => {
    const e = resolveEnv({});
    expect(e).toEqual({
      siteEnv: 'local',
      production: false,
      source: 'fixture',
      snapshotUrl: null,
      imgBaseUrl: DEV_IMG_BASE,
      noindex: true,
      adminOrigin: null,
    });
  });

  it('treats blank, unknown and mistyped PUBLIC_SITE_ENV as non-production', () => {
    for (const v of ['', ' ', 'prod', 'Production', 'staging', undefined]) {
      const e = resolveEnv({ PUBLIC_SITE_ENV: v });
      expect(e.production).toBe(false);
      expect(e.noindex).toBe(true);
      expect(e.siteEnv).toBe('local');
    }
    expect(resolveEnv({ PUBLIC_SITE_ENV: 'preview' }).siteEnv).toBe('preview');
  });

  it('snapshot mode: https url, image base without trailing slash, noindex unless production', () => {
    const preview = resolveEnv({ PUBLIC_SITE_ENV: 'preview', PUBLIC_SNAPSHOT_URL: SNAP, PUBLIC_IMG_BASE_URL: IMG });
    expect(preview.source).toBe('snapshot');
    expect(preview.snapshotUrl).toBe(SNAP);
    expect(preview.imgBaseUrl).toBe('https://img.example.cz');
    expect(preview.noindex).toBe(true);
    const prod = resolveEnv({ PUBLIC_SITE_ENV: 'production', PUBLIC_SNAPSHOT_URL: SNAP, PUBLIC_IMG_BASE_URL: IMG });
    expect(prod.production).toBe(true);
    expect(prod.noindex).toBe(false);
  });

  it('rejects an http snapshot URL', () => {
    expect(() =>
      resolveEnv({ PUBLIC_SNAPSHOT_URL: 'http://img.example.cz/p.json', PUBLIC_IMG_BASE_URL: IMG }),
    ).toThrow(/https/);
  });

  it('rejects an http image base and a missing image base in snapshot mode', () => {
    expect(() => resolveEnv({ PUBLIC_SNAPSHOT_URL: SNAP, PUBLIC_IMG_BASE_URL: 'http://img.example.cz' })).toThrow(/https/);
    expect(() => resolveEnv({ PUBLIC_SNAPSHOT_URL: SNAP })).toThrow(/PUBLIC_IMG_BASE_URL is required/);
  });

  it('rejects a snapshot host that differs from the image host', () => {
    expect(() =>
      resolveEnv({ PUBLIC_SNAPSHOT_URL: 'https://evil.example.com/p.json', PUBLIC_IMG_BASE_URL: IMG }),
    ).toThrow(/host/);
    // look-alike host with the image host as a prefix or subdomain
    expect(() =>
      resolveEnv({ PUBLIC_SNAPSHOT_URL: 'https://img.example.cz.evil.com/p.json', PUBLIC_IMG_BASE_URL: IMG }),
    ).toThrow(/host/);
  });

  it('rejects garbage URLs', () => {
    expect(() => resolveEnv({ PUBLIC_SNAPSHOT_URL: 'not a url', PUBLIC_IMG_BASE_URL: IMG })).toThrow(BuildConfigError);
  });

  it('production without a snapshot URL throws', () => {
    expect(() => resolveEnv({ PUBLIC_SITE_ENV: 'production' })).toThrow(/requires PUBLIC_SNAPSHOT_URL/);
    expect(() => resolveEnv({ PUBLIC_SITE_ENV: 'production', PUBLIC_IMG_BASE_URL: IMG })).toThrow(BuildConfigError);
  });
});

describe('PUBLIC_ADMIN_ORIGIN', () => {
  const prod = { PUBLIC_SITE_ENV: 'production', PUBLIC_SNAPSHOT_URL: SNAP, PUBLIC_IMG_BASE_URL: IMG };

  it('is null when unset or blank, an exact origin when valid', () => {
    expect(resolveEnv({}).adminOrigin).toBeNull();
    expect(resolveEnv({ PUBLIC_ADMIN_ORIGIN: '  ' }).adminOrigin).toBeNull();
    expect(resolveEnv({ ...prod, PUBLIC_ADMIN_ORIGIN: 'https://admin.example.cz' }).adminOrigin).toBe('https://admin.example.cz');
    expect(resolveEnv({ PUBLIC_ADMIN_ORIGIN: 'http://localhost:5173' }).adminOrigin).toBe('http://localhost:5173');
  });

  it('fails the build with a clear message on a path, wildcard, garbage or http in production', () => {
    for (const bad of ['https://admin.example.cz/', 'https://admin.example.cz/app', '*', 'https://*.example.cz', 'admin.example.cz', 'ftp://x.cz', 'https://u:p@admin.example.cz', 'https://admin.example.cz?x=1']) {
      expect(() => resolveEnv({ ...prod, PUBLIC_ADMIN_ORIGIN: bad }), bad).toThrow(/PUBLIC_ADMIN_ORIGIN/);
    }
    expect(() => resolveEnv({ ...prod, PUBLIC_ADMIN_ORIGIN: 'http://admin.example.cz' })).toThrow(/https in a production build/);
    expect(() => resolveEnv({ PUBLIC_ADMIN_ORIGIN: '*' })).toThrow(BuildConfigError);
  });
});

describe('assertProductionOutput', () => {
  it('throws in production when _dev-img exists in the output', () => {
    const seen: string[] = [];
    expect(() =>
      assertProductionOutput({ production: true }, '/out/dist', (p) => {
        seen.push(p);
        return true;
      }),
    ).toThrow(/_dev-img/);
    expect(seen).toEqual(['/out/dist/_dev-img']);
  });

  it('passes in production without _dev-img, and never looks outside production', () => {
    expect(() => assertProductionOutput({ production: true }, '/out/dist', () => false)).not.toThrow();
    expect(() => assertProductionOutput({ production: false }, '/out/dist', () => true)).not.toThrow();
  });
});
