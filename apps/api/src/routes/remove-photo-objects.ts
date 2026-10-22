/** Delete every object under `photos/<id>/`, page by page. Returns the count; storage errors propagate. */
import { photoPrefix, type StorageAdapter } from '@mp/shared';

export async function removePhotoObjects(storage: StorageAdapter, photoId: string): Promise<number> {
  let count = 0;
  let cursor: string | undefined;
  do {
    const page = await storage.list(photoPrefix(photoId), cursor === undefined ? {} : { cursor });
    if (page.objects.length > 0) {
      await storage.delete(page.objects.map((o) => o.key));
      count += page.objects.length;
    }
    cursor = page.cursor;
  } while (cursor !== undefined);
  return count;
}
