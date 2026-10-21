/** docs/NAVOD.md (Czech how-to): every quoted label is a real admin text, no jargon, error table, 10 checkboxes. */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cs } from '../apps/admin/src/i18n/cs';

const root = `${import.meta.dirname}/..`;
const docPath = `${root}/docs/NAVOD.md`;
const doc = readFileSync(docPath, 'utf8');
const lines = doc.split('\n');

/** All string values of the dictionary (arrays included). */
const collect = (value: unknown, out: string[] = []): string[] => {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) collect(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) collect(v, out);
  return out;
};

/** String literals of messages.ts (worker and client error texts), read as source text. */
const messageLiterals = (): string[] => {
  const src = readFileSync(`${root}/apps/admin/src/i18n/messages.ts`, 'utf8');
  return [...src.matchAll(/'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\\n]|\\.)*)`/g)].map((m) => m[1] ?? m[2] ?? '');
};

const adminTexts = [...collect(cs), ...messageLiterals()];
const quoted = [...doc.matchAll(/„([^“\n]+)“/g)].map((m) => m[1] as string);

const section = (title: string): string[] => {
  const start = lines.findIndex((l) => l.startsWith('## ') && l.includes(title));
  expect(start, `heading ${title}`).toBeGreaterThanOrEqual(0);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith('## '));
  return end === -1 ? rest : rest.slice(0, end);
};

describe('docs/NAVOD.md', () => {
  it('has a real set of quoted labels', () => {
    expect(quoted.length).toBeGreaterThanOrEqual(40);
  });

  it('quotes only labels that exist verbatim in the admin Czech messages', () => {
    const missing = [...new Set(quoted)].filter((q) => !adminTexts.some((t) => t.includes(q)));
    expect(missing).toEqual([]);
  });

  it('button-like labels (short, no sentence punctuation) equal a whole admin string exactly', () => {
    const fragments = new Set(['Kategorie obsahuje', 'Zkusit znovu neúspěšné', 'foto', 'Úložiště se plní']);
    const labels = [...new Set(quoted)].filter((q) => q.split(/\s+/).length <= 4 && !/[.!?:]$/.test(q) && !fragments.has(q));
    expect(labels.length).toBeGreaterThan(20);
    const notExact = labels.filter((q) => !adminTexts.includes(q));
    expect(notExact).toEqual([]);
  });

  it('publish steps name both the top-bar link and the button on the publish page', () => {
    const steps = section('Po focení').join('\n');
    const publish = steps.slice(steps.indexOf('### Zveřejnit web'), steps.indexOf('### Ověřit na webu'));
    expect(publish).toMatch(/Nahoře otevři „Zveřejnit web“/);
    expect(publish).toMatch(/Na té stránce klikni na tlačítko „Zveřejnit web“/);
    expect(doc).toMatch(/ve spodní liště otevři „Zveřejnit“/);
    expect(cs.nav.publish).toBe('Zveřejnit');
    expect(steps).toMatch(/Odkaz „Zobrazit web“ se ukáže po dokončeném zveřejnění/);
    expect(section('Když něco nejde').join('\n')).toContain(cs.publish.timeout);
  });

  it('avoids technical jargon', () => {
    const banned = [/snapshot/i, /deploy hook/i, /\br2\b/i, /\bjwt\b/i, /\brls\b/i, /worker/i, /supabase/i, /cloudflare/i];
    for (const re of banned) expect(doc, String(re)).not.toMatch(re);
  });

  it('has the seven required sections in order', () => {
    const headings = lines.filter((l) => /^## \d\. /.test(l)).map((l) => l.slice(3, 4));
    expect(headings).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    const titles = ['Co potřebuješ', 'Po focení krok za krokem', 'Úpravy', 'Úložiště', 'Telefon', 'Když něco nejde', 'Soukromí klientů'];
    for (const t of titles) expect(lines.some((l) => l.startsWith('## ') && l.includes(t)), t).toBe(true);
  });

  it('does not invent an admin address', () => {
    expect(doc).toContain('- Adresu správy. Tu ti pošle Adam.');
    expect(doc).not.toMatch(/https?:\/\//);
  });

  it('has an error table (Co vidím / Co udělat) covering the required situations with real messages', () => {
    const rows = section('Když něco nejde').filter((l) => l.startsWith('|'));
    expect(rows[0]).toBe('| Co vidím | Co udělat |');
    const body = rows.slice(2);
    expect(body.length).toBeGreaterThanOrEqual(6);
    for (const row of body) {
      const cells = row.split('|').slice(1, -1).map((c) => c.trim());
      expect(cells, row).toHaveLength(2);
      expect(cells[0], row).toMatch(/^„[^“]+“$/);
      expect(cells[1], row).not.toBe('');
    }
    const seen = body.map((r) => r.split('|')[1]?.trim() ?? '');
    const required = [
      cs.glossary.retry, // upload failure
      'Úložiště je plné. Nelze nahrát další fotky, uvolněte místo smazáním fotek.',
      'Přihlášení vypršelo, přihlaste se znovu.',
      cs.publishIndicator.pending,
      cs.publish.failed,
      cs.data.unavailable,
    ];
    for (const r of required) expect(seen.some((s) => s.includes(r)), r).toBe(true);
    expect(seen.some((s) => s.includes('Nahrávání selhalo. Zkusit znovu'))).toBe(true);
  });

  it('mentions the storage thresholds and the irreversible delete', () => {
    const storage = section('Úložiště').join('\n');
    expect(storage).toMatch(/8 GB/);
    expect(storage).toMatch(/9,5 GB/);
    expect(section('Úpravy').join('\n')).toMatch(/nevratn/);
    expect(section('Úpravy').join('\n')).toMatch(/záloh/);
  });

  it('privacy section is honest about backups and never claims "smazáno všude"', () => {
    const privacy = section('Soukromí klientů').join('\n');
    expect(privacy).toMatch(/po „Zveřejnit web“/);
    expect(privacy).toMatch(/záloze/);
    expect(doc).not.toMatch(/smazáno všude/i);
  });

  it('ends with exactly 10 checkbox lines', () => {
    const boxes = lines.filter((l) => /^- \[ \] /.test(l));
    expect(boxes).toHaveLength(10);
    expect(lines.filter((l) => /^- \[[xX]\]/.test(l))).toHaveLength(0);
    const firstBox = lines.findIndex((l) => /^- \[ \] /.test(l));
    expect(lines.slice(firstBox).filter((l) => l.startsWith('## '))).toHaveLength(0);
  });

  it('uses second person singular, not the polite plural, in its own sentences', () => {
    const own = lines
      .filter((l) => !l.startsWith('|'))
      .join('\n')
      .replace(/„[^“]*“/g, '');
    expect(own).not.toMatch(/\b(zkuste|klikněte|vyplňte|přihlaste|počkejte)\b/i);
  });

  it('relative links resolve, including heading anchors', () => {
    const slug = (h: string): string =>
      h.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s/g, '-');
    const links = [...doc.matchAll(/\]\((?!https?:|mailto:)([^)\s]+)\)/g)].map((m) => m[1] as string);
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      const [file = '', anchor] = link.split('#');
      const target = file === '' ? docPath : resolve(dirname(docPath), file);
      expect(existsSync(target), link).toBe(true);
      if (anchor) {
        const heads = readFileSync(target, 'utf8')
          .split('\n')
          .filter((l) => /^#{1,6} /.test(l))
          .map((l) => slug(l.replace(/^#+\s+/, '')));
        expect(heads, link).toContain(anchor);
      }
    }
  });

  it('is linked from the short Czech guide in docs/ADMIN.md', () => {
    const admin = readFileSync(`${root}/docs/ADMIN.md`, 'utf8');
    expect(admin).toContain('(NAVOD.md)');
  });

  it('contains no secret-shaped strings', () => {
    expect(doc).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/);
    expect(doc).not.toMatch(/\bsk_[A-Za-z0-9]{10,}/);
    expect(doc).not.toMatch(/\bAKIA[0-9A-Z]{12,}/);
    // assembled at runtime so this file does not itself look like a key block to the repository gate
    expect(doc).not.toMatch(new RegExp(`${'-'.repeat(5)}BEGIN [A-Z ]*PRIVATE ${'KEY'}`));
    // long random-looking runs (link targets are skipped: heading anchors are long but harmless)
    expect(doc.replace(/\]\([^)]*\)/g, '')).not.toMatch(/[A-Za-z0-9+/_-]{40,}/);
  });
});
