/** In-memory R2 bucket for tests (put, head, delete with array, list with truncation and cursor). */
import type { R2BucketPort, R2ObjectPort } from './r2';

export interface FakeR2Bucket extends R2BucketPort {
  /** Sizes of every `delete` call, in order (to assert chunking). */
  readonly deleteCalls: number[];
  keys(): string[];
}

export function createFakeR2Bucket(now: () => Date = () => new Date()): FakeR2Bucket {
  const objects = new Map<string, R2ObjectPort & { body: Uint8Array }>();
  const deleteCalls: number[] = [];
  const view = (o: R2ObjectPort & { body: Uint8Array }): R2ObjectPort => {
    const { body: _body, ...rest } = o;
    return rest;
  };

  return {
    deleteCalls,
    keys: () => [...objects.keys()].sort(),
    async put(key, value, options) {
      const body =
        value instanceof ArrayBuffer
          ? new Uint8Array(value.slice(0))
          : new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
      const obj: R2ObjectPort & { body: Uint8Array } = { key, size: body.byteLength, uploaded: now(), body };
      if (options?.httpMetadata) obj.httpMetadata = { ...options.httpMetadata };
      objects.set(key, obj);
      return view(obj);
    },
    async head(key) {
      const o = objects.get(key);
      return o ? view(o) : null;
    },
    async delete(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      deleteCalls.push(list.length);
      if (list.length > 1000) throw new Error('R2 delete accepts at most 1000 keys');
      for (const k of list) objects.delete(k);
    },
    async list(options = {}) {
      const prefix = options.prefix ?? '';
      const limit = Math.min(1000, Math.max(1, options.limit ?? 1000));
      const matching = [...objects.keys()]
        .sort()
        .filter((k) => k.startsWith(prefix) && (options.cursor === undefined || k > options.cursor));
      const page = matching.slice(0, limit);
      const truncated = matching.length > limit;
      const out: { objects: R2ObjectPort[]; truncated: boolean; cursor?: string } = {
        objects: page.map((k) => view(objects.get(k)!)),
        truncated,
      };
      if (truncated) out.cursor = page[page.length - 1]!;
      return out;
    },
  };
}
