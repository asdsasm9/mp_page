import type { Snapshot, SnapshotAlbum, SnapshotCategory } from '@mp/shared';
import { describe, expect, it } from 'vitest';
import fixtureJson from '../../../../packages/shared/fixtures/snapshot.fixture.json';
import {
  aboutMeta,
  albumMeta,
  categoryMeta,
  checkMetas,
  cookiesMeta,
  homeMeta,
  notFoundMeta,
  portfolioMeta,
  trimWords,
} from './seo';

const fixture = fixtureJson as unknown as Snapshot;
const [weddings, portraits, couples] = fixture.categories as [SnapshotCategory, SnapshotCategory, SnapshotCategory];

describe('golden strings from docs/SEO.md', () => {
  it('Home', () => {
    expect(homeMeta()).toEqual({
      title: 'Fotograf Brno: svatby, portréty, páry | Mullny Photos',
      ogTitle: 'Fotograf Brno: svatby, portréty, páry',
      description:
        'Svatební, portrétní a párový fotograf z Brna. Přirozené fotografie plné emocí, focení v Brně a Jihomoravském kraji. Napište mi o termínu.',
      noindex: false,
    });
    expect(homeMeta().title).toHaveLength(53);
  });

  it('three categories, weddings with the plural count', () => {
    expect(weddings.albums).toHaveLength(4);
    expect(categoryMeta(weddings)).toMatchObject({
      title: 'Svatební fotograf Brno – svatby | Mullny Photos',
      description:
        'Ukázky svatebních fotografií z Brna a okolí. Reportážní focení svatebního dne od příprav po první tanec. Prohlédněte si 4 svatby.',
    });
    expect(categoryMeta(portraits)).toMatchObject({
      title: 'Portrétní focení Brno – portréty a rodiny | Mullny Photos',
      description:
        'Portréty, rodinné a těhotenské focení v Brně, ve studiu nebo u vás doma. Prohlédněte si ukázky mých fotografií.',
    });
    expect(categoryMeta(couples)).toMatchObject({
      title: 'Párové focení Brno – fotky pro páry | Mullny Photos',
      description:
        'Párové a zásnubní focení v Brně a okolí. Uvolněné fotografie, které vás vystihují. Prohlédněte si ukázky.',
    });
  });

  it('weddings count uses the Czech plural forms', () => {
    const withCount = (n: number) =>
      categoryMeta({ ...weddings, albums: weddings.albums.slice(0, 1).concat(Array(n - 1).fill(weddings.albums[0]!)) }).description;
    expect(withCount(1)).toMatch(/Prohlédněte si 1 svatbu\.$/);
    expect(withCount(5)).toMatch(/Prohlédněte si 5 svateb\.$/);
    expect(withCount(22)).toMatch(/Prohlédněte si 22 svateb\.$/);
  });

  it('About', () => {
    expect(aboutMeta()).toMatchObject({
      title: 'O mně – fotografka Terezie Müllnerová, Brno | Mullny Photos',
      description:
        'Jsem Terezie Müllnerová, fotografka z Brna. Specializuji se na svatby, portréty a párové focení. Přečtěte si můj příběh a zkušenosti.',
      noindex: false,
    });
  });

  it('Cookies', () => {
    expect(cookiesMeta().title).toBe('Zásady cookies a ochrany soukromí | Mullny Photos');
    expect(cookiesMeta().noindex).toBe(false);
    expect(cookiesMeta().description).toBe(
      'Zásady používání cookies a ochrany osobních údajů na webu Mullny Photos. Zjistěte, jaké údaje web zpracovává a proč.',
    );
  });

  it('404 has no description and is noindex', () => {
    expect(notFoundMeta()).toEqual({
      title: 'Stránka nenalezena | Mullny Photos',
      ogTitle: 'Stránka nenalezena',
      description: null,
      noindex: true,
    });
  });

  it('Portfolio (decision D-6)', () => {
    const m = portfolioMeta();
    expect(m.title).toBe('Portfolio – svatby, portréty a páry v Brně | Mullny Photos');
    expect(m.description).toBe(
      'Portfolio fotografky z Brna: ukázky svateb, portrétů a párového focení. Prohlédněte si všechny kategorie a výběr mých alb.',
    );
    expect(m.title.length).toBeLessThanOrEqual(65);
    expect(m.description!.length).toBeLessThanOrEqual(160);
  });
});

describe('albums', () => {
  const album = (over: Partial<SnapshotAlbum>): SnapshotAlbum => ({ ...weddings.albums[0]!, ...over });

  it('matches the SEO.md example', () => {
    const sedlakovi = weddings.albums.find((a) => a.slug === 'sedlakovi')!;
    const m = albumMeta(weddings, sedlakovi);
    expect(m.title).toBe('Adam & Eliška – svatba | Mullny Photos');
    expect(m.description).toBe(
      'Svatba Adam & Eliška. 44 fotografií z focení v Brně a okolí od fotografky Mullny Photos.',
    );
  });

  it('adds the place when set and it fits', () => {
    const m = albumMeta(couples, couples.albums.find((a) => a.place === 'Brno')!);
    expect(m.title).toBe('Lucka & Filip – Brno – párové focení | Mullny Photos');
    expect(m.description).toMatch(/^Párové focení Lucka & Filip v místě Brno\. \d+ fotografi/);
  });

  it('uses the SEO text field when filled', () => {
    expect(albumMeta(weddings, album({ seoDescription: '  Vlastní popis.  ' })).description).toBe('Vlastní popis.');
  });

  it('a very long title plus place stays within 65 and 160', () => {
    const long = 'Michal a Rozárka a jejich velká svatba na zámku s celou rodinou a všemi přáteli z celého kraje';
    const m = albumMeta(weddings, album({ title: long, place: 'Lednice na Moravě u Břeclavi' }));
    expect(m.title.length).toBeLessThanOrEqual(65);
    expect(m.title.endsWith(' – svatba | Mullny Photos')).toBe(true);
    expect(m.title).not.toContain('Lednice');
    expect(m.title).toContain('…');
    expect(m.description!.length).toBeLessThanOrEqual(160);
    expect(m.description!.endsWith('z focení v Brně a okolí od fotografky Mullny Photos.')).toBe(true);
  });

  it('an absurdly long title and place still fit the description', () => {
    const long = 'Dlouhý název '.repeat(30).trim();
    const m = albumMeta(weddings, album({ title: long, place: 'Místo '.repeat(20).trim() }));
    expect(m.title.length).toBeLessThanOrEqual(65);
    expect(m.description!.length).toBeLessThanOrEqual(160);
  });

  it('zero duplicates and no problems across the 13 fixture albums and the fixed pages', () => {
    const entries: Array<[string, ReturnType<typeof homeMeta>]> = [
      ['/', homeMeta()],
      ['/portfolio/', portfolioMeta()],
      ['/o-mne/', aboutMeta()],
      ['/cookies/', cookiesMeta()],
      ['/404.html', notFoundMeta()],
    ];
    let albums = 0;
    for (const c of fixture.categories) {
      entries.push([`/${c.slug}/`, categoryMeta(c)]);
      for (const a of c.albums) {
        albums++;
        entries.push([`/${c.slug}/${a.slug}/`, albumMeta(c, a)]);
      }
    }
    expect(albums).toBe(13);
    expect(checkMetas(entries)).toEqual([]);
  });
});

describe('trimWords and checkMetas', () => {
  it('trims at a word boundary with an ellipsis', () => {
    expect(trimWords('krátký', 10)).toBe('krátký');
    const t = trimWords('jedna dva tři čtyři', 12);
    expect(t.length).toBeLessThanOrEqual(12);
    expect(t).toBe('jedna dva…');
  });

  it('reports duplicates, empty and over-limit values', () => {
    const m = (title: string, description: string | null) => ({ title, ogTitle: title, description, noindex: false });
    const problems = checkMetas([
      ['/a/', m('Stejný | Mullny Photos', 'Popis')],
      ['/b/', m('Stejný | Mullny Photos', 'Popis')],
      ['/c/', m('x'.repeat(66), '')],
      ['/d/', m('Jiný | Mullny Photos', 'y'.repeat(161))],
    ]);
    expect(problems).toEqual(
      expect.arrayContaining([
        '/b/: title duplicates /a/',
        '/b/: description duplicates /a/',
        '/c/: title over 65',
        '/c/: empty description',
        '/d/: description over 160',
      ]),
    );
  });
});
