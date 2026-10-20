/**
 * The Worker (docs/API.md). Every response is parsed with the shared zod schema before it is returned.
 * Errors: ApiError (code and status from the error body), NetworkError. `reserve` returns the body
 * as is when the Worker answers 409 STORAGE_FULL with the normal body shape (nothing was accepted):
 * check the per-item results instead of waiting for a throw.
 */
import type {
  CommitRequest,
  CommitResponse,
  DeleteRequest,
  DeleteResponse,
  PublishResponse,
  ReconcileRequest,
  ReconcileResponse,
  ReserveRequest,
  ReserveResponse,
  StorageResponse,
} from '@mp/shared';

export interface ApiPort {
  getStorage(): Promise<StorageResponse>;
  reserve(request: ReserveRequest): Promise<ReserveResponse>;
  commit(request: CommitRequest): Promise<CommitResponse>;
  deletePhotos(request: DeleteRequest): Promise<DeleteResponse>;
  reconcile(request: ReconcileRequest): Promise<ReconcileResponse>;
  publish(): Promise<PublishResponse>;
}
