/**
 * Reads `/_publish.json` on the public site (no-store). The admin compares snapshotGeneratedAt with the
 * value /publish returned. Returns null when the file is missing; throws NetworkError when it cannot be
 * read (for example the CORS header from WP5-24 is not deployed yet).
 */
export interface PublishStatus {
  snapshotGeneratedAt: string;
  builtAt: string;
  counts: { categories: number; albums: number; photos: number };
}

export interface PublishStatusPort {
  read(): Promise<PublishStatus | null>;
}
