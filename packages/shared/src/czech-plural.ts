/**
 * Czech plural-form selection, shared by the admin and the public site.
 * 1 -> 0 (one), whole 2 to 4 -> 1 (few), everything else (0, 5+, fractions) -> 2 (many).
 * Negatives are not special here: -1 is "many". A caller that wants -1 to read like 1
 * passes Math.abs(n) itself.
 */
export type CzechPluralIndex = 0 | 1 | 2;

export function czechPluralIndex(n: number): CzechPluralIndex {
  if (n === 1) return 0;
  if (Number.isInteger(n) && n >= 2 && n <= 4) return 1;
  return 2;
}
