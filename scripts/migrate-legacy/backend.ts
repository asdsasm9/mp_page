// The one interface the migration talks to (plan WP-06 section 3.1). Two implementations:
// HttpBackend (live, step 7) and FakeBackend (tests, fake-backend.ts). The migration code never
// touches Supabase, the Worker or R2 except through this interface.
import type {
  AlbumRow,
  CategoryRow,
  CommitRequest,
  CommitResponse,
  PhotoRow,
  ReserveRequest,
  ReserveResponse,
  StorageResponse,
  UploadTarget,
  WorkerErrorCode,
} from '../../packages/shared/src';

/** Worker/database codes plus the transport-level outcomes a client sees. */
export type BackendErrorCode = WorkerErrorCode | 'NETWORK' | 'PRESIGN_EXPIRED' | 'PUT_REJECTED' | 'SERVER_ERROR';

export class BackendError extends Error {
  constructor(
    readonly code: BackendErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'BackendError';
  }

  /** Network trouble and 5xx are worth a retry; everything else is a decision of the server. */
  get retryable(): boolean {
    return this.code === 'NETWORK' || this.code === 'SERVER_ERROR';
  }
}

export interface CategoryInput {
  id: string;
  slug: string;
  name: string;
  sort: number;
}

export interface AlbumInput {
  id: string;
  category_id: string;
  slug: string;
  title: string;
  place: string | null;
  sort: number;
  legacy_id: string;
  published: boolean;
}

export interface MigrationBackend {
  /** Signs in as the admin. Rejects with NOT_ADMIN (fails closed) before any write is possible. */
  signIn(): Promise<void>;
  listCategories(): Promise<CategoryRow[]>;
  /** Creates the category when its slug is unknown, otherwise returns the stored row untouched (drift is the caller's call). */
  upsertCategory(input: CategoryInput): Promise<CategoryRow>;
  listAlbums(): Promise<AlbumRow[]>;
  /** Creates the album when its legacy_id is unknown, otherwise returns the stored row untouched. */
  upsertAlbum(input: AlbumInput): Promise<AlbumRow>;
  setCover(albumId: string, photoId: string): Promise<void>;
  /** Photos that carry a legacy_key (the only ones the migration owns). */
  listPhotosByLegacyKey(): Promise<PhotoRow[]>;
  /** POST /uploads/reserve */
  reserve(request: ReserveRequest): Promise<ReserveResponse>;
  /** PUT to a presigned target. Rejects PRESIGN_EXPIRED, PUT_REJECTED, NETWORK or SERVER_ERROR. */
  put(target: UploadTarget, bytes: Uint8Array): Promise<void>;
  /** POST /uploads/commit */
  commit(request: CommitRequest): Promise<CommitResponse>;
  /** GET /storage */
  storage(): Promise<StorageResponse>;
  /** True when the object exists in the bucket (public HEAD live); used to find rows with missing objects. */
  objectExists(key: string): Promise<boolean>;
}
