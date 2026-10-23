/**
 * Types of the upload core (ADMIN-UX 3.5, plan 4.6). Pure data: no React, no DOM objects except Blob bodies.
 */
import type { PhotoVariants, UploadKind, WebpTier } from '@mp/shared';

/** What the core needs to know about a picked file (a File satisfies it). */
export interface FileLike {
  readonly name: string;
  readonly size: number;
  readonly type: string;
  readonly lastModified: number;
}

/** One file of a photo, already encoded; `bytes` is exactly `body.size`. */
export interface EncodedFile {
  kind: UploadKind;
  tier?: WebpTier;
  body: Blob;
  bytes: number;
}

/** The result of the browser encoder: everything reserve and commit need. */
export interface EncodedPhoto {
  width: number;
  height: number;
  /** `#rrggbb`; absent when the colour could not be computed (the photo still uploads). */
  dominantColor?: string;
  variants: PhotoVariants;
  files: EncodedFile[];
}

/** Which set the encoder is producing: the overview set ("Připravuji náhledy") or the detail set ("Nahrávám detail"). */
export type EncodePhase = 'previews' | 'detail';

/** Decode + resize + encode one picked file. Throws when the file cannot be processed; honours the signal. */
export interface Encoder {
  /** `onPhase` (optional, additive) is called when the encoder starts each set; the queue shows it as the row step (T-268). */
  encode(file: FileLike, signal: AbortSignal, onPhase?: (phase: EncodePhase) => void): Promise<EncodedPhoto>;
}

export type ItemStatus =
  | 'queued' // Ve frontě
  | 'encoding' // Zpracovávám
  | 'encoded' // processed, waiting for a reserve group
  | 'reserving'
  | 'reserved' // has upload URLs, waiting for an upload slot
  | 'uploading' // Nahrávám
  | 'uploaded' // all PUTs done, waiting for its turn to commit
  | 'committing' // Ukládám
  | 'done' // Hotovo
  | 'failed'
  | 'cancelled';

/** 'refused': the input guard said no (too big, too many pixels); trying again with the same file cannot work. */
export type FailureKind = 'corrupt' | 'refused' | 'storage-full' | 'too-large' | 'upload' | 'commit' | 'server';

export interface ItemFailure {
  kind: FailureKind;
  /** Czech text for the row. */
  message: string;
  /** Technical code for "Podrobnosti" only. */
  code?: string;
}

export interface QueueItem {
  /** The photo id: stays the same across retries (commit is idempotent). */
  id: string;
  albumId: string;
  name: string;
  size: number;
  /** Position in the selection (natural-sort) order, across the whole session. */
  order: number;
  status: ItemStatus;
  /** 0 to 1 while uploading. */
  progress: number;
  /** Waiting for the network ("Čekám na připojení…"). */
  paused: boolean;
  failure: ItemFailure | null;
  /** Which set the encoder is on while `status` is 'encoding'; null otherwise. */
  phase: EncodePhase | null;
  /** Long edge in px of a source below DETAIL_MIN_LONG_EDGE (a warning, never a block); null when big enough or unknown. */
  smallEdge: number | null;
}

export interface QueueState {
  items: QueueItem[];
  online: boolean;
  nextOrder: number;
}

export const TERMINAL: readonly ItemStatus[] = ['done', 'failed', 'cancelled'];
export const isTerminal = (status: ItemStatus): boolean => TERMINAL.includes(status);
