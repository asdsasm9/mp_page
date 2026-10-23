/** Failures of the browser encoder. `userMessage` is the Czech row text (the queue shows it), `code` goes to "Podrobnosti". */
import { cs } from '../i18n/cs';

export type EncodeErrorCode = 'NO_WEBP' | 'HEIC_UNSUPPORTED' | 'TOO_LARGE' | 'TOO_MANY_PIXELS' | 'CORRUPT' | 'PLAN_MISMATCH';

const TEXT: Record<EncodeErrorCode, string> = {
  NO_WEBP: cs.encode.noWebp,
  HEIC_UNSUPPORTED: cs.encode.heic,
  TOO_LARGE: cs.encode.tooLarge,
  TOO_MANY_PIXELS: cs.encode.tooManyPixels,
  CORRUPT: cs.encode.corrupt,
  PLAN_MISMATCH: cs.encode.corrupt,
};

export class EncodeError extends Error {
  readonly userMessage: string;
  constructor(
    readonly code: EncodeErrorCode,
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'EncodeError';
    this.userMessage = TEXT[code];
  }
}

export class EncodeAbortedError extends Error {
  constructor() {
    super('ABORTED');
    this.name = 'AbortError';
  }
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new EncodeAbortedError();
}
