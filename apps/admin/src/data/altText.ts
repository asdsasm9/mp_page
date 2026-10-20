/** Alt text and caption checks of the photo detail: validateAlt (shared) with Czech messages. */
import { ALT_MAX, ALT_WARN, validateAlt } from '@mp/shared';
import { cs } from '../i18n/cs';
import { fill } from '../i18n/format';

export const CAPTION_MAX = 500;

const d = cs.photos.detail;

/** Czech text for one problem string of validateAlt (matched by its stable English start). */
function problemText(problem: string): string {
  if (problem.startsWith('Alt looks like')) return d.altFilename;
  if (problem.startsWith('Alt starts with')) return d.altGeneric;
  if (problem.startsWith('Alt contains')) return d.altPath;
  if (problem.startsWith('Alt is longer')) return fill(d.altTooLong, { max: ALT_MAX });
  return d.altInvalid;
}

export interface AltCheck {
  /** Blocking problems (the save is refused). */
  problems: string[];
  /** Advice that does not block the save. */
  warnings: string[];
}

export function checkAlt(alt: string): AltCheck {
  const result = validateAlt(alt);
  return {
    problems: result.problems.map(problemText),
    warnings: result.warnings.map(() => fill(d.altLong, { max: ALT_WARN })),
  };
}

export const captionProblem = (caption: string): string | undefined =>
  caption.trim().length > CAPTION_MAX ? fill(d.captionTooLong, { max: CAPTION_MAX }) : undefined;

/** A photo has no usable alt text when it is empty or blank. */
export const hasNoAlt = (photo: { alt: string | null }): boolean => (photo.alt ?? '').trim() === '';
