/** Fetches the 1600 px JPEGs of a post as `File`s, in carousel order, ready for `navigator.share({ files })`. */
import { isValidPhotoId, jpegKey } from '@mp/shared';
import type { ShareDeps } from './shareDeps';

/** URL of the 1600 JPEG of a photo on the image origin, or null for an id that is not a valid photo id. */
export function jpegUrl(imgBase: string, photoId: string): string | null {
  return isValidPhotoId(photoId) ? `${imgBase}/${jpegKey(photoId)}` : null;
}

export class ShareFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShareFetchError';
  }
}

/** One placeholder file to ask `canShare` whether file sharing exists at all, before anything is fetched. */
export function probeFile(): File {
  return new File([new Uint8Array(1)], 'foto-1.jpg', { type: 'image/jpeg' });
}

export async function fetchShareFiles(deps: ShareDeps, imgBase: string, photoIds: readonly string[]): Promise<File[]> {
  const urls = photoIds.map((id) => jpegUrl(imgBase, id));
  if (urls.length === 0 || urls.some((url) => url === null)) throw new ShareFetchError('invalid photo id');
  const files = await Promise.all(
    urls.map(async (url, i) => {
      let response: Response;
      try {
        response = await deps.fetch(url!, { credentials: 'omit', mode: 'cors' });
      } catch {
        throw new ShareFetchError('network');
      }
      if (!response.ok) throw new ShareFetchError(`status ${response.status}`);
      const type = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
      if (type !== 'image/jpeg') throw new ShareFetchError(`content-type ${type}`);
      const blob = await response.blob();
      return new File([blob], `foto-${i + 1}.jpg`, { type: 'image/jpeg' });
    }),
  );
  return files;
}
