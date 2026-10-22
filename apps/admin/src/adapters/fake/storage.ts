/** Fake R2 presigned PUT and the public site's `/_publish.json`. */
import {
  UploadAbortedError,
  UploadHttpError,
  type PublishStatusPort,
  type UploadPort,
} from '../../ports';
import { copy, type Core } from './core';

export function createFakeUpload(core: Core): UploadPort {
  const { state, clock } = core;
  return {
    async put(target, body, options = {}) {
      core.guard('upload.put');
      if (options.signal?.aborted) throw new UploadAbortedError();
      const total = body.size;
      options.onProgress?.(0, total);
      if (state.slowPutMs !== null) {
        try {
          await clock.sleep(state.slowPutMs, options.signal);
        } catch {
          throw new UploadAbortedError();
        }
        options.onProgress?.(Math.floor(total / 2), total);
      }
      const grant = state.grants.get(target.url);
      if (!grant || target.method !== 'PUT' || clock.now() > grant.expiresAtMs) throw new UploadHttpError(403);
      // The signature covers the signed headers, so they must arrive exactly as issued. The browser
      // sets content-length itself, so it is checked against the body instead.
      const sent = new Map(Object.entries(target.headers).map(([k, v]) => [k.toLowerCase(), v]));
      for (const [name, value] of Object.entries(grant.headers)) {
        if (name === 'content-length') continue;
        if (sent.get(name) !== value) throw new UploadHttpError(403);
      }
      if (state.enforceContentLength && total !== grant.contentLength) throw new UploadHttpError(403);
      state.objects.set(grant.key, { bytes: total, uploadedAtMs: clock.now() });
      options.onProgress?.(total, total);
    },
  };
}

export function createFakePublishStatus(core: Core): PublishStatusPort {
  const { state, clock } = core;
  return {
    async read() {
      core.guard('publishStatus.read');
      if (state.pendingBuild && clock.now() >= state.pendingBuild.atMs) {
        state.published = state.pendingBuild.status;
        state.pendingBuild = null;
      }
      return copy(state.published);
    },
  };
}
