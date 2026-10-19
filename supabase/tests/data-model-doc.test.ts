import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { API_ERROR_CODES } from '../../packages/shared/src/errors';

const here = dirname(fileURLToPath(import.meta.url));
const doc = readFileSync(join(here, '..', '..', 'docs', 'DATA-MODEL.md'), 'utf8');
const golden = JSON.parse(readFileSync(join(here, 'golden', 'privilege-matrix.json'), 'utf8')) as {
  tables: Record<string, Record<string, Record<string, string>>>;
  functions: Record<string, Record<string, boolean>>;
};

/** Rows of the first markdown table after the given heading, as cell arrays (header and rule skipped). */
function tableAfter(heading: string): string[][] {
  const lines = doc.split('\n');
  const start = lines.findIndex((l) => l.trim() === heading);
  expect(start, `heading ${heading}`).toBeGreaterThanOrEqual(0);
  const rows: string[][] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i]!.trim();
    if (l.startsWith('|')) rows.push(l.slice(1, -1).split('|').map((c) => c.trim()));
    else if (rows.length > 0) break;
  }
  return rows.slice(2);
}

describe('docs/DATA-MODEL.md', () => {
  it('table privilege matrix equals the golden file', () => {
    const fromDoc: Record<string, Record<string, Record<string, string>>> = {};
    for (const [table, role, select, insert, update, del] of tableAfter('### Table privileges')) {
      (fromDoc[table!] ??= {})[role!] = { select: select!, insert: insert!, update: update!, delete: del! };
    }
    expect(fromDoc).toEqual(golden.tables);
  });

  it('function privilege matrix equals the golden file', () => {
    const fromDoc: Record<string, Record<string, boolean>> = {};
    for (const [fn, anon, auth] of tableAfter('### Function execute privileges')) {
      fromDoc[fn!] = { anon: anon === 'yes', authenticated: auth === 'yes' };
    }
    expect(fromDoc).toEqual(golden.functions);
  });

  it('lists every RPC with its error codes, and every shared error code', () => {
    for (const rpc of ['is_admin', 'storage_usage', 'reserve_uploads', 'register_photo', 'delete_photos', 'request_publish', 'record_publish', 'keepalive']) {
      expect(doc, rpc).toContain(`\`${rpc}(`);
    }
    for (const code of API_ERROR_CODES) expect(doc, code).toContain(code);
  });

  it('states the deviations including D-5 and the reservation TTL resolution', () => {
    expect(doc).toContain('D-5');
    expect(doc).toMatch(/15 minutes/);
    expect(doc).toMatch(/60 minutes/);
    expect(doc).toContain('reservation_ttl_min');
    expect(doc).toContain('Tailwind');
  });
});
