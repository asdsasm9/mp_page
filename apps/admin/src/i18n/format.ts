/** Czech number, size, date and plural formatting. Pure; no Intl (output must not depend on ICU data). */

import { czechPluralIndex } from '@mp/shared';

const BYTE_UNITS = ['B', 'kB', 'MB', 'GB', 'TB'] as const;

/** Decimal units like the server (1 GB = 1 000 000 000 B), one decimal, decimal comma: 3_200_000_000 -> "3,2 GB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1000) return `${Math.round(bytes)} B`;
  let unit = 0;
  let value = bytes;
  while (value >= 1000 && unit < BYTE_UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  let rounded = Math.round(value * 10) / 10;
  if (rounded >= 1000 && unit < BYTE_UNITS.length - 1) {
    rounded = 1;
    unit += 1;
  }
  return `${String(rounded).replace('.', ',')} ${BYTE_UNITS[unit]}`;
}

/** Czech plural: 1 -> one, 2 to 4 -> few, everything else (0, 5+, fractions) -> many. */
export function plural(n: number, forms: readonly [one: string, few: string, many: string]): string {
  return forms[czechPluralIndex(n)];
}

/** "1 fotka", "3 fotky", "5 fotek". */
export function formatCount(n: number, forms: readonly [string, string, string]): string {
  return `${n} ${plural(n, forms)}`;
}

/** Fills `{name}` placeholders of a dictionary sentence; unknown names become empty text. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ''));
}

const two =(n: number) => String(n).padStart(2, '0');

/** Last Sunday of a month (UTC date of month `m`, 0-based) at 01:00 UTC: the EU summer-time switch instant. */
function euSwitch(year: number, month: number): number {
  const lastDay = new Date(Date.UTC(year, month + 1, 0));
  return Date.UTC(year, month, lastDay.getUTCDate() - lastDay.getUTCDay(), 1);
}

/** "19. 10. 2026 14:32" in Prague time (CET/CEST by the EU rule), whatever the browser's zone is. */
export function formatPragueDateTime(value: Date | string | number): string {
  const d = value instanceof Date ? value : new Date(value);
  const ms = d.getTime();
  if (Number.isNaN(ms)) return '';
  const year = d.getUTCFullYear();
  const summer = ms >= euSwitch(year, 2) && ms < euSwitch(year, 9);
  const p = new Date(ms + (summer ? 2 : 1) * 3_600_000);
  return `${p.getUTCDate()}. ${p.getUTCMonth() + 1}. ${p.getUTCFullYear()} ${two(p.getUTCHours())}:${two(p.getUTCMinutes())}`;
}

/** A stored calendar date "2026-06-14" as "14. 6. 2026" (no time zone involved); other text is returned unchanged. */
export function formatShotOn(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? `${Number(m[3])}. ${Number(m[2])}. ${m[1]}` : value;
}
