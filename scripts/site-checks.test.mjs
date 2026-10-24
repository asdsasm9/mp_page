import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkPageChecks as gate } from './site-checks.mjs';
import { CHECKS, runChecks } from './gates.mjs';
import {
  checkHead,
  checkHeavyImages,
  checkImages,
  checkInternalLinks,
  checkJsonLd,
  checkLayoutCheckAbsent,
  checkRobots,
  checkSitemapCanonical,
  checkUnique,
  listFiles,
  loadSite,
  routeOf,
  runSiteChecks,
} from './site-checks.mjs';

const O = 'https://www.mullnyphotos.cz';
const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
const crumbs = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [] };

function page(path, { title = `T ${path}`, desc = `D ${path}`, body = '', extra = '', robots = 'noindex, nofollow', lang = 'cs', h1 = 1 } = {}) {
  const route = routeOf(path);
  const url = `${O}${route}`;
  return {
    path,
    html:
      `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8"><title>${title}</title>` +
      `<meta name="description" content="${desc}"><meta name="robots" content="${robots}">` +
      `<link rel="canonical" href="${url}"><meta property="og:type" content="website">` +
      `<meta property="og:title" content="${title}"><meta property="og:description" content="${desc}">` +
      `<meta property="og:url" content="${url}"><meta property="og:image" content="${O}/og.jpg">` +
      `<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${title}">` +
      `<meta name="twitter:description" content="${desc}"><meta name="twitter:image" content="${O}/og.jpg">` +
      `${extra}</head><body>${'<h1>x</h1>'.repeat(h1)}${body}</body></html>`,
  };
}

const notFound = {
  path: '404.html',
  html:
    `<!DOCTYPE html><html lang="cs"><head><title>Nenalezeno</title><meta name="robots" content="noindex, nofollow">` +
    `<link rel="canonical" href="${O}/404/"><meta property="og:title" content="N"><meta property="og:url" content="${O}/404/">` +
    `<meta name="twitter:card" content="summary"><meta name="twitter:title" content="N"></head><body><h1>x</h1></body></html>`,
};

const goodSite = (over = {}) => {
  const pages = [
    page('index.html', { extra: ld({ '@type': 'Photographer' }) + ld({ '@type': 'WebSite' }), body: '<a href="/svatby/">s</a><a href="/old">o</a>' }),
    page('svatby/index.html', {
      extra: ld({ '@type': 'ImageGallery' }) + ld(crumbs),
      body: '<img src="/a.jpg" alt="Svatba, fotografie 1" width="10" height="20"><img src="/b.jpg" alt="" width="1" height="1"><a href="/svatby/x/">x</a><a href="mailto:a@b.cz">m</a><a href="https://x.cz/">e</a><a href="#top">t</a><a href="/favicon.ico">f</a>',
    }),
    page('svatby/x/index.html', { extra: ld({ '@type': 'ImageGallery' }) + ld(crumbs) }),
    notFound,
  ];
  return {
    pages,
    files: ['index.html', 'svatby/index.html', 'svatby/x/index.html', '404.html', 'favicon.ico', 'a.jpg'],
    redirectsText: '# c\n/old /svatby/ 301\n',
    sitemapXml: `<urlset><url><loc>${O}/</loc></url><url><loc>${O}/svatby/</loc></url><url><loc>${O}/svatby/x/</loc></url></urlset>`,
    siteEnv: 'local',
    ...over,
  };
};

const run = (site) => runSiteChecks(site);

describe('good fixture', () => {
  it('is green with no warnings', () => {
    const r = run(goodSite());
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(gate(goodSite())).toMatchObject({ status: 'PASS' });
  });
  it('routeOf maps files to URLs', () => {
    expect([routeOf('index.html'), routeOf('a/b/index.html'), routeOf('404.html')]).toEqual(['/', '/a/b/', '/404/']);
  });
});

describe('head checks go red', () => {
  const base = () => page('svatby/index.html', { extra: ld({ '@type': 'ImageGallery' }) + ld(crumbs) });
  const mutate = (fn) => ({ path: base().path, html: fn(base().html) });
  it('baseline is clean', () => expect(checkHead(base())).toEqual([]));
  it('two titles', () => expect(checkHead(mutate((h) => h.replace('</head>', '<title>b</title></head>'))).join()).toMatch(/2 <title>/));
  it('no description', () =>
    expect(checkHead(mutate((h) => h.replace(/<meta name="description"[^>]*>/, ''))).join()).toMatch(/0 meta descriptions/));
  it('two canonicals', () =>
    expect(checkHead(mutate((h) => h.replace('</head>', `<link rel="canonical" href="${O}/x/"></head>`))).join()).toMatch(/2 canonical/));
  it('relative canonical', () =>
    expect(checkHead(mutate((h) => h.replace(`${O}/svatby/"><meta`, '/svatby/"><meta'))).join()).toMatch(/not absolute/));
  it('canonical without trailing slash', () =>
    expect(checkHead(mutate((h) => h.replace(`href="${O}/svatby/"`, `href="${O}/svatby"`))).join()).toMatch(/trailing slash/));
  it('canonical for another page', () =>
    expect(checkHead(mutate((h) => h.replace(`href="${O}/svatby/"`, `href="${O}/portrety/"`))).join()).toMatch(/does not match/));
  it('no h1 and two h1', () => {
    expect(checkHead(page('svatby/index.html', { h1: 0 })).join()).toMatch(/0 <h1>/);
    expect(checkHead(page('svatby/index.html', { h1: 2 })).join()).toMatch(/2 <h1>/);
  });
  it('wrong lang', () => expect(checkHead(page('svatby/index.html', { lang: 'en' })).join()).toMatch(/lang="cs"/));
  it('missing OG and Twitter tags', () => {
    expect(checkHead(mutate((h) => h.replace(/<meta property="og:image"[^>]*>/, ''))).join()).toMatch(/missing og:image/);
    expect(checkHead(mutate((h) => h.replace(/<meta name="twitter:card"[^>]*>/, ''))).join()).toMatch(/missing twitter:card/);
  });
  it('the 404 page needs no description or image', () => expect(checkHead(notFound)).toEqual([]));
});

describe('images', () => {
  const imgs = (html) => checkImages({ path: 'index.html', html }).join('; ');
  it('accepts alt, empty alt and dimensions', () => expect(imgs('<img src="a" alt="Foto" width="1" height="2"><img src="b" alt width="1" height="2">')).toBe(''));
  it('missing alt', () => expect(imgs('<img src="a" width="1" height="2">')).toMatch(/no alt/));
  it('missing width or height', () => {
    expect(imgs('<img src="a" alt="x" height="2">')).toMatch(/no width/);
    expect(imgs('<img src="a" alt="x" width="1">')).toMatch(/no height/);
  });
  it.each(['IMG_1234.jpg', 'photo.webp', 'DSC00123', 'x.PNG'])('filename-like alt %s', (alt) =>
    expect(imgs(`<img src="a" alt="${alt}" width="1" height="2">`)).toMatch(/filename-like/));
  it('ignores the lightbox dialog image', () => expect(imgs('<dialog><img alt=""></dialog>')).toBe(''));
});

describe('heavy images in the initial HTML', () => {
  const heavy = (html) => checkHeavyImages({ path: 'svatby/x/index.html', html });
  const u = 'https://i.example/photos/0000/';
  it.each([
    `<img src="${u}master.jpg">`,
    `<img src="${u}1600.jpg" srcset="${u}2400.webp 2400w" loading="eager">`,
    `<picture><source srcset="${u}2400.webp 2400w"><img src="${u}480.webp" fetchpriority="high"></picture>`,
    `<link rel="preload" as="image" href="${u}2400.webp">`,
    `<div style="background:url('${u}master.jpg')"></div>`,
  ])('fails %s', (html) => expect(heavy(html)).not.toEqual([]));
  it('also fails through the whole-site run', () => {
    const s = goodSite();
    s.pages[2] = page('svatby/x/index.html', { extra: ld({ '@type': 'ImageGallery' }) + ld(crumbs), body: `<img src="${u}master.jpg" alt="x" width="1" height="1">` });
    expect(run(s).errors.join()).toMatch(/heavy-images: \/svatby\/x\/index.html .*master/);
  });
  it('allows fit tiers, lazy candidate lists, data-lb attributes and plain links', () => {
    expect(
      heavy(
        `<img src="${u}1600.jpg" srcset="${u}480.webp 480w, ${u}720.webp 720w, ${u}2400.webp 2400w" loading="eager" alt="" width="1" height="1">` +
          `<img src="${u}1600.jpg" srcset="${u}960.webp 960w, ${u}2400.webp 2400w" loading="lazy" alt="" width="1" height="1">` +
          `<a href="${u}1600.jpg" data-lb-set="${u}1600.webp 1600w, ${u}2400.webp 2400w" data-lb-master="${u}master.jpg">x</a>`,
      ),
    ).toEqual([]);
  });
});

describe('json-ld', () => {
  const p = (path, ...blocks) => ({ path, html: `<html><head>${blocks.join('')}</head></html>` });
  it('home needs Photographer and WebSite', () => {
    expect(checkJsonLd(p('index.html', ld({ '@type': 'Photographer' })))).toEqual(['JSON-LD type WebSite missing']);
  });
  it('unparsable JSON-LD', () =>
    expect(checkJsonLd(p('index.html', '<script type="application/ld+json">{oops</script>')).join()).toMatch(/does not parse/));
  it('Review is rejected, also nested', () => {
    const r = checkJsonLd(p('svatby/index.html', ld({ '@type': 'ImageGallery', review: { '@type': 'Review' } }), ld(crumbs)));
    expect(r.join()).toMatch(/Review/);
  });
  it('AggregateRating is rejected', () =>
    expect(checkJsonLd(p('svatby/index.html', ld({ '@type': 'ImageGallery' }), ld(crumbs), ld({ '@type': 'AggregateRating' }))).join()).toMatch(/AggregateRating/));
  it('unexpected type on 404 and cookies', () => {
    expect(checkJsonLd(p('404.html', ld(crumbs)))).toEqual(['JSON-LD type BreadcrumbList not expected on this page']);
    expect(checkJsonLd(p('cookies/index.html', ld({ '@type': 'ImageGallery' }), ld(crumbs))).join()).toMatch(/ImageGallery not expected/);
  });
  it('home carries Photographer and WebSite; Person is not expected there and other types are rejected', () => {
    const base = [ld({ '@type': 'Photographer' }), ld({ '@type': 'WebSite' })];
    expect(checkJsonLd(p('index.html', ...base))).toEqual([]);
    expect(checkJsonLd(p('index.html', ...base, ld({ '@type': 'Person' }))).join()).toMatch(/Person not expected/);
    expect(checkJsonLd(p('index.html', ...base, ld({ '@type': 'ImageGallery' }))).join()).toMatch(/ImageGallery not expected/);
  });
  it('/o-mne/ needs Person and BreadcrumbList (T-293); /kontakt/ has no rule (no such page)', () => {
    expect(checkJsonLd(p('o-mne/index.html', ld({ '@type': 'Person' }), ld(crumbs)))).toEqual([]);
    expect(checkJsonLd(p('o-mne/index.html', ld(crumbs))).join()).toMatch(/Person missing/);
    expect(checkJsonLd(p('o-mne/index.html', ld({ '@type': 'Person' }), ld(crumbs), ld({ '@type': 'ImageGallery' }))).join()).toMatch(/ImageGallery not expected/);
    expect(checkJsonLd(p('kontakt/index.html', ld({ '@type': 'Photographer' }), ld(crumbs))).join()).toMatch(/ImageGallery missing/);
  });
});

describe('robots', () => {
  const idx = page('svatby/index.html', { robots: 'index, follow' });
  const noidx = page('svatby/index.html', { robots: 'noindex, nofollow' });
  it('production: indexable pages must not be noindex, 404 must be', () => {
    expect(checkRobots(idx, 'production')).toEqual([]);
    expect(checkRobots(noidx, 'production')).toHaveLength(1);
    expect(checkRobots(notFound, 'production')).toEqual([]);
    expect(checkRobots({ path: '404.html', html: '<head><meta name="robots" content="index"></head>' }, 'production')).toHaveLength(1);
  });
  it('non-production: noindex everywhere', () => {
    expect(checkRobots(noidx, 'preview')).toEqual([]);
    expect(checkRobots(idx, 'local')).toHaveLength(1);
  });
});

describe('site wide', () => {
  it('duplicate titles and descriptions', () => {
    const r = checkUnique([page('a/index.html', { title: 'Same', desc: 'd1' }), page('b/index.html', { title: 'Same', desc: 'd1' })]);
    expect(r).toHaveLength(2);
    expect(checkUnique(goodSite().pages)).toEqual([]);
  });
  it('dead internal href', () => {
    const s = goodSite();
    s.pages[2] = page('svatby/x/index.html', { extra: ld({ '@type': 'ImageGallery' }) + ld(crumbs), body: '<a href="/nope/">n</a><a href="/svatby">ok? no</a>' });
    const r = checkInternalLinks(s.pages, s);
    expect(r.join()).toMatch(/"\/nope\/"/);
  });
  it('href to a redirect source, file or page resolves', () => {
    const s = goodSite();
    expect(checkInternalLinks(s.pages, s)).toEqual([]);
  });
  it('sitemap and canonical sets must agree', () => {
    const s = goodSite();
    expect(checkSitemapCanonical(s.pages, s.sitemapXml)).toEqual([]);
    expect(checkSitemapCanonical(s.pages, s.sitemapXml.replace('<url><loc>' + O + '/svatby/x/</loc></url>', '')).join()).toMatch(/not in the sitemap/);
    expect(checkSitemapCanonical(s.pages, s.sitemapXml.replace('</urlset>', `<url><loc>${O}/ghost/</loc></url></urlset>`)).join()).toMatch(/ghost/);
    expect(checkSitemapCanonical(s.pages, null)).toEqual(['sitemap.xml is missing']);
    // Redirect-only pages (exact _redirects source) are exempt; other pages are not.
    const red = { path: 'stary/index.html', html: `<html><head><link rel="canonical" href="${O}/stary/"></head></html>` };
    expect(checkSitemapCanonical([...s.pages, red], s.sitemapXml).join()).toMatch(/stary\/ is not in the sitemap/);
    expect(checkSitemapCanonical([...s.pages, red], s.sitemapXml, '/stary/ /#kontakt 301\n')).toEqual([]);
    expect(
      checkSitemapCanonical([...s.pages, red], s.sitemapXml.replace('<url><loc>' + O + '/svatby/x/</loc></url>', ''), '/stary/ /#kontakt 301\n').join(),
    ).toMatch(/svatby\/x\/ is not in the sitemap/);
  });
});

describe('[doplnit] marker', () => {
  const withMarker = (siteEnv) => {
    const s = goodSite({ siteEnv });
    s.pages[1] = page('svatby/index.html', {
      extra: ld({ '@type': 'ImageGallery' }) + ld(crumbs),
      body: '<dd>[doplnit]</dd>',
      robots: siteEnv === 'production' ? 'index, follow' : 'noindex, nofollow',
    });
    if (siteEnv === 'production') {
      s.pages = s.pages.map((pg) => (pg.path === '404.html' ? pg : { ...pg, html: pg.html.replace('noindex, nofollow', 'index, follow') }));
    }
    return s;
  };
  it('only warns in local and preview builds', () => {
    for (const env of ['local', 'preview']) {
      const r = run(withMarker(env));
      expect(r.errors).toEqual([]);
      expect(r.warnings.join()).toMatch(/\/svatby\/index\.html/);
      expect(gate(withMarker(env)).status).toBe('PASS');
      expect(gate(withMarker(env)).details).toMatch(/WARNING/);
    }
  });
  it('fails a production build', () => {
    const r = run(withMarker('production'));
    expect(r.errors.join()).toMatch(/placeholder/);
    expect(gate(withMarker('production')).status).toBe('FAIL');
  });
  it('a production build without the marker is green', () => {
    const s = withMarker('production');
    s.pages[1] = { ...s.pages[1], html: s.pages[1].html.replace('[doplnit]', 'Jan Novák') };
    expect(run(s).errors).toEqual([]);
  });
});

describe('gate registration', () => {
  it('page-checks is SKIP without dist and no longer PENDING', () => {
    expect(gate(null)).toMatchObject({ status: 'SKIP' });
    const row = CHECKS.find((c) => c.name === 'page-checks');
    expect(row.input).toBe('site');
    expect(runChecks({ files: [], dist: [] }, { checks: [row] }).rows[0].status).toBe('SKIP');
  });
  it('the gate fails on a bad site', () => {
    const s = goodSite();
    s.pages[0] = { ...s.pages[0], html: s.pages[0].html.replace('lang="cs"', 'lang="en"') };
    const row = CHECKS.find((c) => c.name === 'page-checks');
    const out = runChecks({ files: [], dist: [], site: s }, { checks: [row] });
    expect(out.rows[0].status).toBe('FAIL');
    expect(out.exitCode).toBe(1);
  });
});

describe('layout-check absence (T-221)', () => {
  const build = (publish) => {
    const dir = mkdtempSync(join(tmpdir(), 'site-checks-lc-'));
    const w = (rel, text) => {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), text);
    };
    w('index.html', '<html lang="cs"></html>');
    w('layout-check/a/index.html', '<html></html>');
    if (publish) w('_publish.json', JSON.stringify(publish));
    return dir;
  };
  const errorsFor = (publish) => {
    const dir = build(publish);
    try {
      return checkLayoutCheckAbsent(loadSite(dir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  it('fails in production and snapshot builds', () => {
    expect(errorsFor({ siteEnv: 'production', source: 'fixture' })).toHaveLength(1);
    expect(errorsFor({ siteEnv: 'preview', source: 'snapshot' })).toHaveLength(1);
  });
  it('passes for fixture/dev builds and without layout-check', () => {
    expect(errorsFor({ siteEnv: 'local', source: 'fixture' })).toEqual([]);
    expect(errorsFor(null)).toEqual([]);
    expect(checkLayoutCheckAbsent({ files: ['index.html'], siteEnv: 'production', source: 'snapshot' })).toEqual([]);
  });
  it('is part of runSiteChecks', () => {
    const { errors } = runSiteChecks({ pages: [], files: ['layout-check/x/index.html'], siteEnv: 'production', source: null });
    expect(errors.some((e) => e.startsWith('layout-check:'))).toBe(true);
  });
});

describe('loadSite', () => {
  it('returns null without index.html and reads siteEnv from _publish.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'site-checks-'));
    try {
      expect(loadSite(dir)).toBeNull();
      const w = (rel, text) => {
        mkdirSync(dirname(join(dir, rel)), { recursive: true });
        writeFileSync(join(dir, rel), text);
      };
      w('index.html', '<html lang="cs"></html>');
      w('a/index.html', '<html></html>');
      w('_publish.json', JSON.stringify({ siteEnv: 'production' }));
      w('_redirects', '/x /y 301\n');
      const site = loadSite(dir);
      expect(site.siteEnv).toBe('production');
      expect(site.pages.map((pg) => pg.path).sort()).toEqual(['a/index.html', 'index.html']);
      expect(site.redirectsText).toContain('/x');
      expect(listFiles(dir)).toContain('a/index.html');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
