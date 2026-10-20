/** Czech number, size, date and plural formatting. Pure; no Intl (output must not depend on ICU data). */

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
  if (n === 1) return forms[0];
  if (Number.isInteger(n) && n >= 2 && n <= 4) return forms[1];
  return forms[2];
}

/** "1 fotka", "3 fotky", "5 fotek". */
export function formatCount(n: number, forms: readonly [string, string, string]): string {
  return `${n} ${plural(n, forms)}`;
}

const two = (n: number) => String(n).padStart(2, '0');

/** "19. 10. 2026 14:32" in the browser's local time; empty text for an invalid date. */
export function formatDateTime(value: Date | string | number): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** "19. 10. 2026". */
export function formatDate(value: Date | string | number): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`;
}
