import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { HASH_REDIRECT_SCRIPT, mapHash } from './hash-redirect';

/** Every row of CONTENT-MAPPING 7.2 (15 mapped rows, the unknown-id row as a sample) plus the 9 never-linked albums. */
const TABLE: Array<[string, string]> = [
  ['#/', '/'],
  ['#/home', '/'],
  ['#/portfolio', '/portfolio/'],
  ['#/weddings', '/svatby/'],
  ['#/weddings/frankovi', '/svatby/frankovi/'],
  ['#/weddings/hradsti', '/svatby/hradsti/'],
  ['#/weddings/sedlakovi', '/svatby/sedlakovi/'],
  ['#/weddings/suranovi', '/svatby/suranovi/'],
  ['#/portraits', '/portrety/'],
  ['#/couples', '/parove-foceni/'],
  ['#/about', '/#o-mne'],
  ['#/contact', '/#kontakt'],
  ['#/weddings/unknown-id', '/svatby/'],
  ['#/nonsense', '/'],
  ['#/portraits/anez', '/portrety/anez/'],
  ['#/portraits/lucka', '/portrety/lucka/'],
  ['#/portraits/lukas', '/portrety/lukas/'],
  ['#/portraits/mia', '/portrety/mia/'],
  ['#/portraits/pati', '/portrety/pati/'],
  ['#/portraits/pati2', '/portrety/pati2/'],
  ['#/couples/pavla_rafael', '/parove-foceni/pavla_rafael/'],
  ['#/couples/helis_tom', '/parove-foceni/helis_tom/'],
  ['#/couples/lucka_filip', '/parove-foceni/lucka_filip/'],
  // extra cases of plan 4.8
  ['#/weddings/typo', '/svatby/'],
  ['#/weddings/sedlakovi?x=1', '/svatby/sedlakovi/'],
  ['#/weddings/sedlakovi/', '/svatby/sedlakovi/'],
  ['#/weddings/', '/svatby/'],
  ['#/portfolio/extra', '/'],
  ['#/weddings/portraits', '/svatby/'],
  ['#/weddings/anez', '/svatby/'],
  ['#/weddings/frankovi%20hradsti', '/svatby/'],
  ['#/weddings/frankovi hradsti', '/svatby/'],
  ['#/constructor', '/'],
  ['#/__proto__', '/'],
  ['#/toString', '/'],
  ['#/hasOwnProperty', '/'],
  ['#/constructor/x', '/'],
  ['#/weddings/constructor', '/svatby/'],
  ['#/weddings/__proto__', '/svatby/'],
  ['#//evil.example', '/'],
  ['#/https://evil.example', '/'],
];

const NO_CALL = ['', '#', '#section', '#kategorie', 'x#/home', '/#/home', '#uvod', '#o-mne', '#portfolio', '#reference', '#kontakt'];

/** Runs the exact script text with a fake `location`; returns the replace() arguments. */
function run(hash: string): string[] {
  const calls: string[] = [];
  runInNewContext(HASH_REDIRECT_SCRIPT, { location: { hash, replace: (u: string) => calls.push(u) } });
  return calls;
}

describe('hash-redirect', () => {
  it('maps every table row, in the script and in mapHash', () => {
    for (const [hash, to] of TABLE) {
      expect(run(hash), hash).toEqual([to]);
      expect(mapHash(hash), hash).toBe(to);
    }
  });

  it('never calls replace without a #/ prefix', () => {
    for (const hash of NO_CALL) {
      expect(run(hash), hash).toEqual([]);
      expect(mapHash(hash), hash).toBeNull();
    }
  });

  it('only ever redirects to a path from the fixed tables', () => {
    for (const hash of ['#/constructor', '#/weddings/<script>', '#/portraits/%2e%2e', '#/couples/a/b']) {
      expect(run(hash)[0], hash).toMatch(/^\/(?:(?:svatby|portrety|parove-foceni|portfolio)\/|#o-mne|#kontakt)?$/);
    }
  });

  it('is under 800 bytes, plain text, and guards the only location.replace with #/', () => {
    expect(Buffer.byteLength(HASH_REDIRECT_SCRIPT)).toBeLessThan(800);
    expect(HASH_REDIRECT_SCRIPT).not.toContain('\n');
    expect(HASH_REDIRECT_SCRIPT.match(/location\.replace\(/g)).toHaveLength(1);
    expect(HASH_REDIRECT_SCRIPT.match(/location\./g)).toHaveLength(2);
    expect(HASH_REDIRECT_SCRIPT.indexOf("indexOf('#/')")).toBeLessThan(HASH_REDIRECT_SCRIPT.indexOf('location.replace('));
    expect(HASH_REDIRECT_SCRIPT).toContain('hasOwnProperty');
  });
});
