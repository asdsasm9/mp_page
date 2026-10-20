import { readFileSync, readdirSync } from 'node:fs';
import { WORKER_ERROR_CODES } from '@mp/shared';
import { describe, expect, it } from 'vitest';
import { ApiError, AuthError, CatalogError, NetworkError, UploadHttpError } from '../ports/errors';
import { cs } from './cs';
import { formatBytes, formatCount, formatDateTime, plural } from './format';
import { MESSAGE_CODES, errorCode, errorMessage, messageForCode } from './messages';

const CODE_LIKE = /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b|\b[A-Z]{4,}\b/;

describe('messages', () => {
  const required = [...WORKER_ERROR_CODES, 'COVER_NOT_IN_ALBUM', 'INVALID_STATUS', 'NETWORK', 'UNKNOWN'];

  it.each(required)('%s has a Czech text without an upper-case code', (code) => {
    expect(MESSAGE_CODES).toContain(code);
    const text = messageForCode(code, { retryAfter: 12 });
    expect(text.length).toBeGreaterThan(5);
    expect(text).toMatch(/[a-zěščřžýáíéúůďťň]/);
    expect(text).not.toMatch(CODE_LIKE);
  });

  it('every text ends like a sentence or a button label', () => {
    for (const code of MESSAGE_CODES) expect(messageForCode(code, { retryAfter: 3 })).not.toMatch(/\s$/);
  });

  it('uses the exact ADMIN-UX texts', () => {
    expect(messageForCode('STORAGE_FULL')).toBe(
      'Úložiště je plné. Nelze nahrát další fotky, uvolněte místo smazáním fotek.',
    );
    expect(messageForCode('NETWORK')).toBe('Chybí připojení k internetu.');
    expect(messageForCode('UPSTREAM_ERROR')).toBe('Správa je dočasně nedostupná. Veřejný web funguje dál.');
    expect(messageForCode('CONFLICT')).toBe('Toto album bylo změněno jinde. Načíst znovu.');
    expect(messageForCode('NOT_ADMIN')).toBe('Tento účet nemá přístup do správy.');
  });

  it('PUBLISH_TOO_SOON names the seconds with Czech plurals', () => {
    expect(messageForCode('PUBLISH_TOO_SOON', { retryAfter: 1 })).toContain('za 1 sekunda');
    expect(messageForCode('PUBLISH_TOO_SOON', { retryAfter: 3 })).toContain('za 3 sekundy');
    expect(messageForCode('PUBLISH_TOO_SOON', { retryAfter: 42 })).toContain('za 42 sekund');
    expect(messageForCode('PUBLISH_TOO_SOON')).not.toMatch(/undefined|NaN/);
  });

  it('an unknown code gets the generic text, never the code', () => {
    expect(messageForCode('SOMETHING_NEW')).toBe(messageForCode('UNKNOWN'));
    expect(messageForCode('SOMETHING_NEW')).not.toContain('SOMETHING');
  });

  it('maps thrown errors and keeps the code for Podrobnosti only', () => {
    const api = new ApiError('STORAGE_FULL');
    expect(errorMessage(api)).toBe(messageForCode('STORAGE_FULL'));
    expect(errorCode(api)).toBe('STORAGE_FULL');
    expect(errorMessage(new ApiError('PUBLISH_TOO_SOON', { retryAfter: 5 }))).toContain('za 5 sekund');
    expect(errorMessage(new NetworkError())).toBe(messageForCode('NETWORK'));
    expect(errorCode(new NetworkError())).toBe('NETWORK');
    expect(errorMessage(new CatalogError('DUPLICATE_SLUG'))).toBe('Tato adresa je už použitá.');
    expect(errorMessage(new AuthError('INVALID_CREDENTIALS'))).toBe('Nesprávný e-mail nebo heslo.');
    expect(errorMessage(new UploadHttpError(403))).not.toMatch(/403/);
    expect(errorCode(new UploadHttpError(403))).toBe('HTTP 403');
    expect(errorMessage(new Error('boom'))).toBe(messageForCode('UNKNOWN'));
    expect(errorMessage('x')).not.toContain('x ');
  });
});

describe('formatBytes', () => {
  it('formats with a decimal comma', () => {
    expect(formatBytes(3_200_000_000)).toBe('3,2 GB');
    expect(formatBytes(9_500_000_000)).toBe('9,5 GB');
    expect(formatBytes(12_000_000)).toBe('12 MB');
    expect(formatBytes(41_943_040)).toBe('41,9 MB');
    expect(formatBytes(1500)).toBe('1,5 kB');
    expect(formatBytes(999)).toBe('999 B');
    expect(formatBytes(0)).toBe('0 B');
  });

  it('survives bad input and rounding up to the next unit', () => {
    expect(formatBytes(Number.NaN)).toBe('0 B');
    expect(formatBytes(-5)).toBe('0 B');
    expect(formatBytes(999_999)).toBe('1 MB');
    expect(formatBytes(2_000_000_000_000)).toBe('2 TB');
  });
});

describe('plural and dates', () => {
  it('follows Czech plural rules', () => {
    expect(formatCount(1, cs.units.photo)).toBe('1 fotka');
    expect(formatCount(2, cs.units.photo)).toBe('2 fotky');
    expect(formatCount(4, cs.units.photo)).toBe('4 fotky');
    expect(formatCount(5, cs.units.photo)).toBe('5 fotek');
    expect(formatCount(0, cs.units.photo)).toBe('0 fotek');
    expect(formatCount(40, cs.units.photo)).toBe('40 fotek');
    expect(plural(3, cs.units.album)).toBe('alba');
    expect(plural(5, cs.units.album)).toBe('alb');
  });

  it('formats dates like the spec', () => {
    expect(formatDateTime(new Date(2026, 9, 19, 14, 32))).toBe('19. 10. 2026 14:32');
    expect(formatDateTime(new Date(2026, 0, 5, 7, 5))).toBe('5. 1. 2026 07:05');
    expect(formatDateTime('not a date')).toBe('');
  });
});

describe('glossary', () => {
  // docs/ADMIN-UX.md section 7, split on commas and slashes.
  const words = [
    'Přihlásit se', 'Odhlásit se', 'E-mail', 'Heslo', 'Zapomenuté heslo', 'Kategorie', 'Nová kategorie', 'Album', 'Alba',
    'Nové album', 'Fotky', 'Vybrat fotky', 'Název', 'Adresa', 'Místo', 'Datum focení', 'Popis', 'Popisek',
    'Alternativní text', 'Pro vyhledávače', 'SEO titulek', 'SEO popis', 'Titulní fotka', 'Nastavit jako titulní',
    'Zveřejnit album', 'Skrýt album', 'Zveřejnit web', 'Zveřejněno', 'Koncept', 'Skryto', 'Viditelná', 'Skrytá',
    'Smazat', 'Zrušit', 'Uložit', 'Uloženo', 'Zkusit znovu', 'Přesunout', 'Přesunout do alba', 'Posunout nahoru',
    'Posunout dolů', 'Nahrávání', 'Ve frontě', 'Zpracovávám', 'Nahrávám', 'Hotovo', 'Úložiště', 'Zkontrolovat úložiště',
    'Podrobnosti',
  ];

  it('contains every ADMIN-UX word exactly', () => {
    const values = Object.values(cs.glossary) as string[];
    for (const w of words) expect(values, w).toContain(w);
    expect(values.length).toBe(words.length);
  });
});

describe('no Czech sentences in .tsx', () => {
  const srcDir = `${import.meta.dirname}/..`;
  const files = (readdirSync(srcDir, { recursive: true }) as string[]).filter(
    (f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx'),
  );

  it('finds the component files', () => {
    expect(files.length).toBeGreaterThan(3);
  });

  it.each(files)('%s has no diacritics and no JSX text', (file) => {
    const source = readFileSync(`${srcDir}/${file}`, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(source).not.toMatch(/[áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]/);
    // JSX text node with letters, e.g. <p>Hello</p> (expressions in braces are fine).
    expect(source).not.toMatch(/(?<![=-])>\s*[A-Za-z][^<>{}]*</);
  });
});
