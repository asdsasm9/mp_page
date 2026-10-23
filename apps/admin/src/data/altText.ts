/** Alt text and caption checks of the photo detail: validateAlt (shared) with Czech messages. */
import { ALT_MAX, ALT_WARN, CAPTION_MAX, validateAlt, type AltProblem } from '@mp/shared';
import { cs } from '../i18n/cs';
import { fill } from '../i18n/format';

const d = cs.photos.detail;

/** Czech text for one problem of validateAlt, chosen by its stable code (the English message is ignored). */
export function problemText(problem: AltProblem): string {
  switch (problem.code) {
    case 'FILENAME':
      return d.altFilename;
    case 'GENERIC_PREFIX':
      return d.altGeneric;
    case 'PATH_SEPARATOR':
      return d.altPath;
    case 'TOO_LONG':
      return fill(d.altTooLong, { max: ALT_MAX });
    default:
      return d.altInvalid;
  }
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
