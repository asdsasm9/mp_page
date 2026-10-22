/**
 * `/_publish.json` (plan WP-3 section 4.7). The admin polls it and compares `snapshotGeneratedAt` with what
 * `/publish` returned, so it must carry the snapshot's own timestamp, not the build time.
 */
import type { Snapshot } from '@mp/shared';
import type { SiteEnv } from './env';

export interface PublishJson {
  schemaVersion: 1;
  snapshotGeneratedAt: string;
  builtAt: string;
  counts: Snapshot['counts'];
  siteEnv: SiteEnv;
  source: 'snapshot' | 'fixture';
}

export function buildPublishJson(
  snapshot: Pick<Snapshot, 'generatedAt' | 'counts'>,
  env: { siteEnv: SiteEnv; source: 'snapshot' | 'fixture' },
  now: Date,
): PublishJson {
  return {
    schemaVersion: 1,
    snapshotGeneratedAt: snapshot.generatedAt,
    builtAt: now.toISOString(),
    counts: snapshot.counts,
    siteEnv: env.siteEnv,
    source: env.source,
  };
}
