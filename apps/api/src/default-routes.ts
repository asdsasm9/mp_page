/** The Worker's route table (WP-4 section 4.7). Each entry is built per request from the R2 storages. */
import type { Route } from './index';
import type { Storages } from './storage/bindings';
import { createCommitRoute } from './routes/commit';
import { createDeleteRoute } from './routes/delete';
import { createPublishRoute } from './routes/publish';
import { createReconcileRoute } from './routes/reconcile';
import { createReserveRoute } from './routes/reserve';
import { storageRoute } from './routes/storage';

export const DEFAULT_ROUTES: Readonly<Record<string, (s: Storages) => Route>> = {
  '/storage': () => storageRoute,
  '/uploads/reserve': (s) => createReserveRoute({ storage: s.photos }),
  '/uploads/commit': (s) => createCommitRoute({ storage: s.photos }),
  '/photos/delete': (s) => createDeleteRoute({ storage: s.photos }),
  '/storage/reconcile': (s) => createReconcileRoute({ storage: s.photos }),
  '/publish': (s) => createPublishRoute({ publicBucket: s.photos }),
};
