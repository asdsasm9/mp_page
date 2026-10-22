/**
 * Real UploadPort: one presigned PUT over XMLHttpRequest (fetch has no upload progress). The signed headers from the
 * reserve response go out exactly as issued, except content-length: the browser sets it from the body itself and
 * would refuse (or the signature would break) if a script tried. Nothing here logs and no URL leaves this module.
 */
import { NetworkError, UploadAbortedError, UploadHttpError, type UploadPort } from '../../ports';

export type XhrFactory = () => XMLHttpRequest;

const OWN_HEADER = 'content-length';

export function createXhrUpload(factory: XhrFactory = () => new XMLHttpRequest()): UploadPort {
  return {
    put(target, body, options = {}) {
      return new Promise<void>((resolve, reject) => {
        const { signal, onProgress } = options;
        if (signal?.aborted) return reject(new UploadAbortedError());
        const xhr = factory();
        const onAbort = () => xhr.abort();
        const done = () => signal?.removeEventListener('abort', onAbort);

        xhr.open(target.method, target.url);
        for (const [name, value] of Object.entries(target.headers)) {
          if (name.toLowerCase() === OWN_HEADER) continue;
          xhr.setRequestHeader(name, value);
        }
        xhr.upload.onprogress = (event) => onProgress?.(event.loaded, event.lengthComputable ? event.total : body.size);
        xhr.onload = () => {
          done();
          if (xhr.status >= 200 && xhr.status < 300) {
            onProgress?.(body.size, body.size);
            resolve();
          } else {
            reject(new UploadHttpError(xhr.status));
          }
        };
        xhr.onerror = () => {
          done();
          reject(new NetworkError());
        };
        xhr.ontimeout = xhr.onerror;
        xhr.onabort = () => {
          done();
          reject(new UploadAbortedError());
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        xhr.send(body);
      });
    },
  };
}
