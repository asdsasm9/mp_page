/** Time and identity are injected so tests control them (publish rate limit, expiry, backoff). */

export interface Clock {
  /** Milliseconds since the epoch. */
  now(): number;
  /** Resolves after `ms`; rejects with an AbortError-named error when the signal fires first. */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export interface Ids {
  /** A new lowercase v4 UUID. */
  uuid(): string;
}

function abortError(): Error {
  const e = new Error('ABORTED');
  e.name = 'AbortError';
  return e;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep(ms, signal) {
    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(abortError());
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        reject(abortError());
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  },
};

export const systemIds: Ids = { uuid: () => crypto.randomUUID() };

export { abortError };
