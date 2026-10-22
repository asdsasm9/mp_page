/**
 * Czech texts for every failure the UI can show (ADMIN-UX sections 3 and 6). The technical code is never
 * part of the text; `errorDetails` returns it for the "Podrobnosti" disclosure only.
 */
import type { WorkerErrorCode } from '@mp/shared';
import { ApiError, AuthError, CatalogError, NetworkError, UploadHttpError } from '../ports/errors';
import { cs } from './cs';
import { formatCount } from './format';

export type MessageOptions = { retryAfter?: number };

/** Codes that exist only in the client or in the database layer, on top of the Worker codes. */
export type ExtraErrorCode =
  | 'COVER_NOT_IN_ALBUM'
  | 'INVALID_STATUS'
  | 'NETWORK'
  | 'UNKNOWN'
  | 'STALE'
  | 'DUPLICATE_SLUG'
  | 'IN_USE'
  | 'INVALID'
  | 'INVALID_CREDENTIALS'
  | 'TOO_MANY_ATTEMPTS'
  | 'WEAK_PASSWORD'
  | 'UPLOAD_FAILED';

type Entry = string | ((options: MessageOptions) => string);

const WORKER: Record<WorkerErrorCode, Entry> = {
  UNAUTHENTICATED: 'Přihlášení vypršelo, přihlaste se znovu.',
  NOT_ADMIN: 'Tento účet Google nemá přístup do správy.',
  INVALID_REQUEST: 'Server požadavek nepřijal. Zkuste to znovu.',
  INVALID_ID: 'Odkaz na položku není platný. Načtěte stránku znovu.',
  INVALID_ITEMS: 'Některé položky nejsou platné. Načtěte stránku znovu.',
  NOT_FOUND: 'Položka už neexistuje. Načtěte stránku znovu.',
  ALBUM_NOT_FOUND: 'Album už neexistuje. Načtěte stránku znovu.',
  METHOD_NOT_ALLOWED: 'Tuto akci server nepovoluje. Obraťte se na správce webu.',
  PAYLOAD_TOO_LARGE: 'Odesílaných dat je příliš mnoho. Zkuste méně fotek najednou.',
  BATCH_TOO_LARGE: 'Najednou lze nahrát jen omezený počet fotek. Vyberte jich méně.',
  FILE_TOO_LARGE: 'Soubor je příliš velký.',
  STORAGE_FULL: 'Úložiště je plné. Nelze nahrát další fotky, uvolněte místo smazáním fotek.',
  CONFLICT: 'Toto album bylo změněno jinde. Načíst znovu.',
  KEY_MISMATCH: 'Nahrávání se nepodařilo ověřit. Zkusit znovu.',
  BYTES_MISMATCH: 'Nahrávání se nepodařilo ověřit. Zkusit znovu.',
  PUBLISH_TOO_SOON: ({ retryAfter }) =>
    retryAfter === undefined
      ? 'Web se právě zveřejnil. Zkuste to znovu za chvíli.'
      : `Web se právě zveřejnil. Zkuste to znovu za ${formatCount(retryAfter, cs.units.second)}.`,
  UPSTREAM_ERROR: 'Správa je dočasně nedostupná. Veřejný web funguje dál.',
  CONFIG_ERROR: 'Server není správně nastavený. Obraťte se na správce webu.',
  PUBLISH_FAILED: 'Zveřejnění se nepodařilo. Web zůstává ve stavu před touto změnou. Zkusit znovu.',
  SNAPSHOT_EMPTY: 'Nelze zveřejnit web bez jediného zveřejněného alba.',
  INTERNAL: 'Na serveru došlo k chybě. Zkuste to znovu.',
};

const EXTRA: Record<ExtraErrorCode, Entry> = {
  COVER_NOT_IN_ALBUM: 'Titulní fotka musí být z tohoto alba.',
  INVALID_STATUS: 'Album nemá stav, který by šel nastavit. Načtěte stránku znovu.',
  NETWORK: 'Chybí připojení k internetu.',
  UNKNOWN: 'Něco se nepovedlo. Zkuste to znovu.',
  STALE: 'Toto album bylo změněno jinde. Načíst znovu.',
  DUPLICATE_SLUG: 'Tato adresa je už použitá.',
  IN_USE: 'Položka ještě něco obsahuje. Nejdřív její obsah přesuňte nebo smažte.',
  INVALID: 'Některá hodnota není platná. Zkontrolujte ji a zkuste to znovu.',
  INVALID_CREDENTIALS: 'Nesprávný e-mail nebo heslo.',
  TOO_MANY_ATTEMPTS: 'Příliš mnoho pokusů, zkuste to za chvíli.',
  WEAK_PASSWORD: 'Heslo nevyhovuje požadavkům. Zvolte delší nebo složitější heslo.',
  UPLOAD_FAILED: 'Nahrávání selhalo. Zkusit znovu',
};

/** Every code the table can map (used by tests to prove nothing is missing). */
export const MESSAGE_CODES = [...Object.keys(WORKER), ...Object.keys(EXTRA)] as readonly string[];

function render(entry: Entry, options: MessageOptions): string {
  return typeof entry === 'function' ? entry(options) : entry;
}

/** Czech text for a code. Unknown codes get the generic text, never the code itself. */
export function messageForCode(code: string, options: MessageOptions = {}): string {
  if (Object.hasOwn(WORKER, code)) return render(WORKER[code as WorkerErrorCode], options);
  if (Object.hasOwn(EXTRA, code)) return render(EXTRA[code as ExtraErrorCode], options);
  return render(EXTRA.UNKNOWN, options);
}

/** The code behind an error, for the "Podrobnosti" disclosure only. */
export function errorCode(error: unknown): string {
  if (error instanceof ApiError || error instanceof CatalogError || error instanceof AuthError) return error.code;
  if (error instanceof NetworkError) return 'NETWORK';
  if (error instanceof UploadHttpError) return `HTTP ${error.status}`;
  return 'UNKNOWN';
}

/** Czech text for any thrown value from the ports. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return messageForCode(error.code, error.retryAfter === undefined ? {} : { retryAfter: error.retryAfter });
  }
  if (error instanceof CatalogError || error instanceof AuthError) return messageForCode(error.code);
  if (error instanceof NetworkError) return messageForCode('NETWORK');
  if (error instanceof UploadHttpError) return messageForCode('UPLOAD_FAILED');
  return messageForCode('UNKNOWN');
}
