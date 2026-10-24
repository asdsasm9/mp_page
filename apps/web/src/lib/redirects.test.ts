import { describe, expect, it } from 'vitest';
import { MAX_REDIRECT_ROWS, RedirectsError, buildRedirects, collectRedirects, staticRedirects } from './redirects';

const IMG = 'https://img.mullnyphotos.cz';
const OG = '/_astro/og.abc123.jpg';

/** CONTENT-MAPPING 7.3 path rows as data (D-6: no /portfolio rows; /portfolio/ is a real page). */
const DOC_TABLE: Array<[string, string]> = [
  ['/index.html', '/'],
  ['/home', '/'],
  ['/home/', '/'],
  ['/weddings', '/svatby/'],
  ['/weddings/', '/svatby/'],
  ['/portraits', '/portrety/'],
  ['/portraits/', '/portrety/'],
  ['/couples', '/parove-foceni/'],
  ['/couples/', '/parove-foceni/'],
  ['/about', '/o-mne/'],
  ['/about/', '/o-mne/'],
  ['/kontakt/', '/#kontakt'],
  ['/kontakt', '/#kontakt'],
  ['/contact', '/#kontakt'],
  ['/contact/', '/#kontakt'],
  ['/manifest.json', '/manifest.webmanifest'],
  ['/fotky_web/site/preview/preview.jpg', OG],
];
const ALBUMS: Record<string, [string, string[]]> = {
  weddings: ['svatby', ['frankovi', 'hradsti', 'sedlakovi', 'suranovi']],
  portraits: ['portrety', ['anez', 'lucka', 'lukas', 'mia', 'pati', 'pati2']],
  couples: ['parove-foceni', ['pavla_rafael', 'helis_tom', 'lucka_filip']],
};
for (const [old, [slug, ids]] of Object.entries(ALBUMS)) {
  for (const id of ids) {
    DOC_TABLE.push([`/${old}/${id}`, `/${slug}/${id}/`], [`/${old}/${id}/`, `/${slug}/${id}/`]);
  }
}

const fail = (rows: Parameters<typeof buildRedirects>[0]['data'], re: RegExp) => {
  expect(() => buildRedirects({ imgOrigin: IMG, data: rows })).toThrow(RedirectsError);
  expect(() => buildRedirects({ imgOrigin: IMG, data: rows })).toThrow(re);
};

describe('static redirects', () => {
  it('covers every row of the doc table, all 301', () => {
    const rows = staticRedirects(OG);
    for (const [from, to] of DOC_TABLE) {
      expect(rows.find((r) => r.from === from), from).toEqual({ from, to, status: 301 });
    }
    expect(rows).toHaveLength(DOC_TABLE.length);
  });

  it('sends /about to the /o-mne/ page and /kontakt/ to the home section, without a chain', () => {
    const rows = staticRedirects(OG);
    const about = rows.filter((r) => r.to === '/o-mne/').map((r) => r.from);
    const contact = rows.filter((r) => r.to === '/#kontakt').map((r) => r.from);
    expect(about.sort()).toEqual(['/about', '/about/']);
    expect(contact.sort()).toEqual(['/contact', '/contact/', '/kontakt', '/kontakt/']);
    expect(rows.some((r) => r.from === '/o-mne/' || r.from === '/o-mne')).toBe(false); // a real page again (T-293)
    expect(() => collectRedirects({ imgOrigin: IMG, ogImagePath: OG })).not.toThrow();
    expect(buildRedirects({ imgOrigin: IMG, ogImagePath: OG })).toContain('/about/ /o-mne/ 301\n');
  });

  it('has no /portfolio rows (D-6) and no wildcard', () => {
    const text = buildRedirects({ imgOrigin: IMG, ogImagePath: OG });
    expect(text).not.toMatch(/^\/portfolio/m);
    expect(text).not.toContain('*');
  });

  it('matches the golden head of the file', () => {
    const lines = buildRedirects({ imgOrigin: IMG, ogImagePath: OG }).split('\n');
    expect(lines.slice(0, 5)).toEqual([
      '/index.html / 301',
      '/home / 301',
      '/home/ / 301',
      '/weddings /svatby/ 301',
      '/weddings/ /svatby/ 301',
    ]);
    expect(lines.at(-1)).toBe('');
  });

  it('skips the preview row without an OG path', () => {
    expect(buildRedirects({ imgOrigin: IMG })).not.toContain('preview.jpg');
  });
});

describe('data rows', () => {
  it('accepts 141 legacy image rows with absolute image-host targets', () => {
    const data = Array.from({ length: 141 }, (_, i) => ({
      from: `/fotky_web/galleries/weddings/frankovi/${i + 1}.jpg`,
      to: `${IMG}/photos/p${i}/1600.jpg`,
      status: 301 as const,
    }));
    const text = buildRedirects({ imgOrigin: IMG, data });
    expect(text).toContain(`/fotky_web/galleries/weddings/frankovi/141.jpg ${IMG}/photos/p140/1600.jpg 301\n`);
    expect(text.split('\n').filter(Boolean)).toHaveLength(staticRedirects().length + 141);
  });

  it('accepts path targets and the site origin', () => {
    const text = buildRedirects({
      imgOrigin: IMG,
      data: [
        { from: '/svatby/old/', to: '/svatby/frankovi/', status: 301 },
        { from: '/svatby/old2/', to: 'https://www.mullnyphotos.cz/svatby/frankovi/', status: 301 },
      ],
    });
    expect(text).toContain('/svatby/old/ /svatby/frankovi/ 301');
    expect(text).toContain('/svatby/old2/ https://www.mullnyphotos.cz/svatby/frankovi/ 301');
  });

  it('drops 410 rows by default and keeps them when enabled', () => {
    const data = [{ from: '/gone/', to: null, status: 410 as const }];
    expect(buildRedirects({ imgOrigin: IMG, data })).not.toContain('/gone/');
    expect(buildRedirects({ imgOrigin: IMG, data, emit410: true })).toContain('/gone/ - 410\n');
  });
});

describe('hostile rows are rejected', () => {
  it('newline in source or target', () => {
    fail([{ from: '/a\n/b /c 301', to: '/x/', status: 301 }], /whitespace, a newline/);
    fail([{ from: '/a/', to: '/x/\n/evil / 301', status: 301 }], /newline/);
  });
  it('asterisk and colon in source', () => {
    fail([{ from: '/a/*', to: '/x/', status: 301 }], /"\*"/);
    fail([{ from: '/a/:id', to: '/x/', status: 301 }], /":"/);
  });
  it('asterisk and colon in a path target', () => {
    fail([{ from: '/a/', to: '/x/:splat', status: 301 }], /":"/);
    fail([{ from: '/a/', to: '/x/*', status: 301 }], /"\*"/);
  });
  it('foreign host, protocol-relative, http, garbage', () => {
    fail([{ from: '/a/', to: 'https://evil.example/x', status: 301 }], /foreign host/);
    fail([{ from: '/a/', to: 'https://img.mullnyphotos.cz.evil.example/x', status: 301 }], /foreign host/);
    fail([{ from: '/a/', to: '//evil.example/x', status: 301 }], /protocol-relative/);
    fail([{ from: '/a/', to: `${IMG.replace('https', 'http')}/x`, status: 301 }], /https/);
    fail([{ from: '/a/', to: 'javascript:alert(1)', status: 301 }], /https/);
    fail([{ from: '/a/', to: 'nope', status: 301 }], /neither a path/);
  });
  it('source not starting with a single slash', () => {
    fail([{ from: 'a/', to: '/x/', status: 301 }], /start with/);
    fail([{ from: '//evil.example', to: '/x/', status: 301 }], /start with/);
  });
  it('self redirect', () => {
    fail([{ from: '/a/', to: '/a/', status: 301 }], /itself/);
    fail([{ from: '/a/', to: 'https://www.mullnyphotos.cz/a/', status: 301 }], /itself/);
  });
  it('chains, also into the static rows', () => {
    fail(
      [
        { from: '/a/', to: '/b/', status: 301 },
        { from: '/b/', to: '/c/', status: 301 },
      ],
      /chain/,
    );
    fail([{ from: '/a/', to: '/home', status: 301 }], /chain/);
  });
  it('duplicate source, also against the static rows', () => {
    fail([{ from: '/home', to: '/x/', status: 301 }], /duplicate/);
  });
  it('a 301 without a target', () => {
    fail([{ from: '/a/', to: null, status: 301 }], /no target/);
  });
  it('2000+ rows', () => {
    const data = Array.from({ length: 2000 }, (_, i) => ({ from: `/o/${i}/`, to: `/n/${i}/`, status: 301 as const }));
    fail(data, /exceed the limit/);
    expect(MAX_REDIRECT_ROWS).toBeLessThan(2000);
  });
  it('accepts exactly the limit', () => {
    const room = MAX_REDIRECT_ROWS - staticRedirects().length;
    const data = Array.from({ length: room }, (_, i) => ({ from: `/o/${i}/`, to: `/n/${i}/`, status: 301 as const }));
    expect(collectRedirects({ imgOrigin: IMG, data })).toHaveLength(MAX_REDIRECT_ROWS);
  });
});
