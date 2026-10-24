// Legacy hash-route redirect (CONTENT-MAPPING 7.2, plan 4.8). The old site was a single page with
// `/#/weddings/sedlakovi` style routes; a fragment never reaches the server, so Home carries a tiny
// inline script that maps it to the new path.
//
// The output is always a value from the fixed tables below, never derived from the input (no open
// redirect). Lookups use hasOwnProperty / array membership, so `#/constructor`, `#/__proto__` and
// `#/toString` fall through to `/` (the reference script in the doc had that prototype bug).
//
// T-67 (CSP): this script is inline, so the `script-src` needs its sha256. The postbuild hashes every
// inline script in dist except JSON-LD, so nothing is to be listed by hand. Do not edit the text
// without rebuilding; the built home HTML must contain exactly HASH_REDIRECT_SCRIPT.

const CATEGORIES = new Map<string, string>([
  ['weddings', 'svatby'],
  ['portraits', 'portrety'],
  ['couples', 'parove-foceni'],
]);

const PAGES = new Map<string, string>([
  ['', '/'],
  ['home', '/'],
  ['portfolio', '/portfolio/'],
  ['about', '/o-mne/'],
  ['contact', '/#kontakt'],
]);

const ALBUMS = new Map<string, readonly string[]>([
  ['weddings', ['frankovi', 'hradsti', 'sedlakovi', 'suranovi']],
  ['portraits', ['anez', 'lucka', 'lukas', 'mia', 'pati', 'pati2']],
  ['couples', ['pavla_rafael', 'helis_tom', 'lucka_filip']],
]);

/**
 * Maps `location.hash` to the new path, or `null` when no redirect must happen
 * (the hash does not start with `#/`).
 */
export function mapHash(hash: string): string | null {
  if (!hash.startsWith('#/')) return null;
  const parts = hash.slice(2).split('?')[0]!.replace(/\/+$/, '').split('/');
  const first = parts[0]!;
  const second = parts[1];
  const cat = CATEGORIES.get(first);
  if (cat !== undefined) {
    const known = ALBUMS.get(first)!;
    return second && known.includes(second) ? `/${cat}/${second}/` : `/${cat}/`;
  }
  const page = PAGES.get(first);
  if (page !== undefined && !second) return page;
  return '/';
}

/** Minified inline script. Same logic as `mapHash`; tests run it in node:vm against the same table. */
export const HASH_REDIRECT_SCRIPT =
  "(function(){var h=location.hash;if(h.indexOf('#/')!==0)return;" +
  "var p=h.slice(2).split('?')[0].replace(/\\/+$/,'').split('/'),k=p[0],q=p[1]," +
  'o=function(m,x){return Object.prototype.hasOwnProperty.call(m,x)},' +
  "c={weddings:'svatby',portraits:'portrety',couples:'parove-foceni'}," +
  "g={'':'/',home:'/',portfolio:'/portfolio/',about:'/o-mne/',contact:'/#kontakt'}," +
  "a={weddings:'frankovi hradsti sedlakovi suranovi',portraits:'anez lucka lukas mia pati pati2'," +
  "couples:'pavla_rafael helis_tom lucka_filip'},t='/';" +
  "if(o(c,k)){t='/'+c[k]+'/';if(q&&a[k].split(' ').indexOf(q)>-1)t+=q+'/'}" +
  'else if(o(g,k)&&!q)t=g[k];location.replace(t)})();';
