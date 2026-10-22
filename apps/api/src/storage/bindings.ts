/**
 * Builds the StorageAdapter from the Worker's one R2 binding: `PHOTOS` (public bucket, presign
 * credentials, public URL). There is no second (backup) bucket and no backups at all (T-222, D-17).
 */
import type { StorageAdapter } from '@mp/shared';
import type { Config, RawEnv } from '../env';
import { createR2Storage, type R2BucketPort } from './r2';

export interface Storages {
  photos: StorageAdapter;
}

export const BINDING_NAMES = ['PHOTOS'] as const;

function isBucket(v: unknown): v is R2BucketPort {
  if (typeof v !== 'object' || v === null) return false;
  const b = v as Record<string, unknown>;
  return ['put', 'head', 'delete', 'list'].every((m) => typeof b[m] === 'function');
}

/** Names of the bindings that are missing or not bucket-shaped (empty when all are fine). */
export function missingBindings(raw: RawEnv | undefined): string[] {
  return BINDING_NAMES.filter((n) => !isBucket(raw?.[n]));
}

export function storagesFromEnv(raw: RawEnv | undefined, config: Config): Storages | null {
  if (missingBindings(raw).length > 0) return null;
  return {
    photos: createR2Storage({
      bucket: raw!.PHOTOS as R2BucketPort,
      publicBaseUrl: config.r2PublicBaseUrl,
      presign: {
        accountId: config.r2AccountId,
        accessKeyId: config.r2AccessKeyId,
        secretAccessKey: config.r2SecretAccessKey,
        bucketName: config.r2Bucket,
      },
    }),
  };
}
