import type { ApiPort } from './api';
import type { AuthPort } from './auth';
import type { CatalogPort } from './catalog';
import type { PublishStatusPort } from './publish-status';
import type { Clock, Ids } from './runtime';
import type { UploadPort } from './upload';

export * from './api';
export * from './auth';
export * from './catalog';
export * from './errors';
export * from './publish-status';
export * from './runtime';
export * from './upload';

/** Everything the app talks to. Built once at start-up by adapters/select.ts and passed down by context. */
export interface Ports {
  auth: AuthPort;
  catalog: CatalogPort;
  api: ApiPort;
  upload: UploadPort;
  publishStatus: PublishStatusPort;
  clock: Clock;
  ids: Ids;
}
