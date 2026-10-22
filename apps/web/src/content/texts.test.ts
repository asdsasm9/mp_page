import { describe, expect, it } from 'vitest';
import * as texts from './texts';
import { REVIEWS } from './reviews';

function collect(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) collect(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) collect(v, out);
  return out;
}

// DROPPED_LEGACY quotes the old strings on purpose, so it is excluded from the content scan.
const { DROPPED_LEGACY, ...content } = texts;
const all = [...collect(content), ...collect(REVIEWS)];

describe('texts', () => {
  it('has strings', () => {
    expect(all.length).toBeGreaterThan(40);
  });

  it.each(['Jihomoravskom', 'Pavidelne', 'portrétu'])('no string contains %s', (bad) => {
    expect(all.filter((s) => s.includes(bad))).toEqual([]);
  });

  it('has no double spaces, newlines, or edge whitespace', () => {
    expect(all.filter((s) => /\s{2,}/.test(s) || s !== s.trim())).toEqual([]);
  });

  it('has no English placeholder', () => {
    const english = /non found|enable JavaScript|\bThis is\b|\bImage\b|\bPhoto \d/;
    expect(all.filter((s) => english.test(s))).toEqual([]);
  });

  it('has no sentence starting in lowercase after a period', () => {
    expect(all.filter((s) => /\. [a-zěščřžýáíéúůďťň]/.test(s))).toEqual([]);
  });

  it('mailto constant has no space', () => {
    expect(texts.MAIL_URL).toBe('mailto:mullnyphotos@gmail.com');
    expect(texts.MAIL_URL).not.toMatch(/\s/);
    expect(texts.CONTACT.contact.buttonHref).toBe(texts.MAIL_URL);
  });
});

describe('AUDIT section 4 coverage', () => {
  const present = (needle: string) => expect(all.some((s) => s.includes(needle)), needle).toBe(true);

  it('has every legacy string or lists it as dropped', () => {
    for (const s of [
      'ZOBRAZIT VÍC',
      'https://www.instagram.com/mullny_photos/?hl=cs',
      'mullnyphotos@gmail.com',
      'KATEGORIE',
      'SVATBY',
      'PORTRÉTY',
      'PÁROVÉ FOCENÍ',
      'Vítejte na mé stránce',
      'Terezie Müllnerová',
      'Vzpomínky jsou pomíjivé',
      'RECENZE',
      'O MNĚ',
      'MÉ ZKUŠENOSTI',
      'přes 46 000 fotek portrétů, 12 000 fotek svateb a 4 000 fotek produktů',
      'MŮJ PŘIBĚH',
      'KONTAKT',
      'INSTAGRAM',
      '@mullny_photos',
      'Úvod',
      'Portfolio',
      'Svatby',
      'Portréty',
      'Párové focení',
      'O mně',
      'Kontakt',
      'MULLNY',
      'Fotím v Jihomoravském kraji',
      'Svatební fotograf Terezie Müllnerová (Brno, Česko) | MyWed',
      'Mullny photos',
      'Focení svateb, portrétů a párových fotek',
      'Focení s Terkou byla skvělá zkušenost',
      'Spolupráce s Terkou byla úžasná',
    ]) present(s);
    const dropped = DROPPED_LEGACY.map((d) => d.legacy);
    for (const s of ['You need to enable JavaScript to run this app.', 'This is non found']) {
      expect(dropped).toContain(s);
    }
  });

  it('has two reviews with album ids', () => {
    expect(REVIEWS.map((r) => r.albumId)).toEqual(['pati', 'anez']);
  });
});
