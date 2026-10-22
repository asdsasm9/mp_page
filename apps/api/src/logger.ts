/**
 * Redacting request logger (WP-4 section 4.9). Logs contain route, status, error code, error NAME and
 * the request id only: never tokens, bodies, URLs or error messages (which may echo input). The field
 * set is closed by type, so a caller cannot pass free text through by accident.
 */

export interface LogFields {
  method?: string;
  /** Path only, never the query string. */
  path?: string;
  status?: number;
  code?: string;
  errorName?: string;
  /** Names of invalid configuration variables (never values). */
  invalid?: string[];
}

export interface Logger {
  readonly requestId: string;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

const SAFE_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/** The class name of a thrown value if it looks like an identifier, else a fixed label. Never the message. */
export function errorName(e: unknown): string {
  const name = e instanceof Error ? e.name : '';
  return SAFE_NAME.test(name) ? name : 'UnknownError';
}

export function newRequestId(): string {
  return crypto.randomUUID();
}

export function createLogger(requestId: string): Logger {
  const line = (level: string, event: string, fields: LogFields = {}): string =>
    JSON.stringify({
      level,
      event,
      requestId,
      method: fields.method,
      path: fields.path,
      status: fields.status,
      code: fields.code,
      errorName: fields.errorName,
      invalid: fields.invalid,
    });
  return {
    requestId,
    info: (event, fields) => console.info(line('info', event, fields)),
    warn: (event, fields) => console.warn(line('warn', event, fields)),
    error: (event, fields) => console.error(line('error', event, fields)),
  };
}
