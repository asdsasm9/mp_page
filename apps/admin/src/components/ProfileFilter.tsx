/**
 * Filter above the Instagram preview (WP-15, D7): a native radio group in a fieldset (visually hidden legend "Zobrazit"),
 * styled as the segmented control of the post editor. The chosen one is filled and carries a check mark (never colour
 * alone). The state lives in the URL search param `zobrazit` (vse | zverejnene | naplanovane, anything else = vse).
 * A polite live region says how many posts are shown.
 */
import { IG_FILTERS, type IgFilter } from '@mp/shared';
import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { cs } from '../i18n/cs';
import { fill } from '../i18n/format';

export const FILTER_PARAM = 'zobrazit';
const SLUG: Record<IgFilter, string> = { all: 'vse', posted: 'zverejnene', planned: 'naplanovane' };

/** Filter from the URL value; an unknown or missing value is "Vše". */
export function parseFilter(value: string | null): IgFilter {
  return IG_FILTERS.find((f) => SLUG[f] === value) ?? 'all';
}

/** The filter kept in the URL (`?zobrazit=`); "Vše" removes the param. Changing it replaces the history entry. */
export function useIgFilter(): [IgFilter, (next: IgFilter) => void] {
  const [params, setParams] = useSearchParams();
  const filter = parseFilter(params.get(FILTER_PARAM));
  const set = useCallback(
    (next: IgFilter) =>
      setParams(
        (prev) => {
          const out = new URLSearchParams(prev);
          if (next === 'all') out.delete(FILTER_PARAM);
          else out.set(FILTER_PARAM, SLUG[next]);
          return out;
        },
        { replace: true },
      ),
    [setParams],
  );
  return [filter, set];
}

interface Props {
  value: IgFilter;
  onChange: (next: IgFilter) => void;
  /** Number of posts under each filter. */
  counts: Record<IgFilter, number>;
}

export function ProfileFilter({ value, onChange, counts }: Props) {
  const t = cs.instagram.filter;
  return (
    <>
      <fieldset className="ig-filter">
        <legend className="visually-hidden">{t.legend}</legend>
        <div className="segmented">
          {IG_FILTERS.map((f) => (
            <label key={f} className="segmented-option">
              <input
                type="radio"
                name="ig-filter"
                className="visually-hidden"
                value={f}
                checked={value === f}
                onChange={() => onChange(f)}
              />
              {value === f ? (
                <svg className="ig-filter-check" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
                  <path d="M3 8.5l3.5 3.5L13 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : null}
              <span>{t[f]}</span>
              <span className="ig-filter-count">{counts[f]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <p className="visually-hidden" role="status" aria-live="polite">
        {fill(t.shown, { n: counts[value] })}
      </p>
    </>
  );
}
