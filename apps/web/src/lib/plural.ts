/**
 * Czech plural helper (plan WP-3, section 4.6). Czech has three forms for whole numbers:
 * 1 -> `one`, 2 to 4 -> `few`, everything else (0, 5 and more, 11, 22, 100) -> `many`.
 * Unlike Polish or Russian, 22 is `many` ("22 svateb"), not `few`.
 */
import { czechPluralIndex } from '@mp/shared';

export interface PluralForms {
  readonly one: string;
  readonly few: string;
  readonly many: string;
}

export function pluralForm(n: number, forms: PluralForms): string {
  return [forms.one, forms.few, forms.many][czechPluralIndex(Math.abs(n))]!;
}

/** `plural(4, forms)` gives `4 svatby`. */
export function plural(n: number, forms: PluralForms): string {
  return `${n} ${pluralForm(n, forms)}`;
}
