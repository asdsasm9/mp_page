import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Builds the real site into a temp dir (fixture mode) and checks the shell of the home page.
const webRoot = new URL('../..', import.meta.url).pathname;
let out = '';
let html = '';

beforeAll(() => {
  out = mkdtempSync(join(tmpdir(), 'mp-web-'));
  execFileSync('npx', ['astro', 'build', '--outDir', out], {
    cwd: webRoot,
    env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1', PUBLIC_SITE_ENV: '', PUBLIC_SNAPSHOT_URL: '' },
    stdio: 'pipe',
  });
  html = readFileSync(join(out, 'index.html'), 'utf8');
}, 180_000);

afterAll(() => {
  if (out) rmSync(out, { recursive: true, force: true });
});

const count = (re: RegExp): number => [...html.matchAll(re)].length;

describe('Base layout (built home page)', () => {
  it('is Czech with exactly one main landmark and one h1', () => {
    expect(html).toContain('<html lang="cs">');
    expect(count(/<main[\s>]/g)).toBe(1);
    expect(count(/<h1[\s>]/g)).toBe(1);
  });

  it('puts the skip link first in the tab order and targets main', () => {
    const body = html.slice(html.indexOf('<body>'));
    const firstFocusable = /<(a|button|summary|input|select|textarea)[\s>]/.exec(body);
    expect(firstFocusable?.[1]).toBe('a');
    expect(body).toMatch(/^<body><a class="skip-link" href="#obsah">/);
    expect(html).toContain('<main id="obsah"');
  });

  it('has six header nav links and marks the current page', () => {
    const nav = /<nav aria-label="Hlavní navigace"[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? '';
    const hrefs = [...nav.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual(['/portfolio/', '/svatby/', '/portrety/', '/parove-foceni/', '/o-mne/', '/kontakt/']);
    // On the home page the logo link is the current page.
    expect(html).toMatch(/class="logo" href="\/"[^>]*aria-current="page"/);
  });

  it('uses a native details disclosure for the menu', () => {
    expect(html).toMatch(/<details class="menu" data-menu[^>]*><summary/);
  });

  it('carries canonical, robots, Open Graph and Twitter tags', () => {
    expect(html).toContain('<link rel="canonical" href="https://www.mullnyphotos.cz/">');
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    for (const tag of ['og:title', 'og:description', 'og:url', 'og:locale', 'og:site_name', 'og:type']) {
      expect(html).toContain(`property="${tag}"`);
    }
    for (const tag of ['twitter:card', 'twitter:title', 'twitter:description']) {
      expect(html).toContain(`name="${tag}"`);
    }
  });

  it('has no href="#" and loads nothing from a third-party host', () => {
    expect(html).not.toMatch(/href="#"/);
    const tags = [...html.matchAll(/<(?:link|script|img|source|iframe)\b[^>]*>/g)].map((m) => m[0]);
    const external = tags.filter(
      (t) => !t.includes('rel="canonical"') && /\b(?:src|href|srcset)="(?:https?:)?\/\//.test(t),
    );
    expect(external).toEqual([]);
  });
});
