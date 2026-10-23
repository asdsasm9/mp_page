import {
  CommitRequestSchema,
  ReserveRequestSchema,
  planUploadFiles,
  variantPlan,
  type CommitRequest,
  type ReserveRequest,
  type ReserveResponse,
  type UploadTarget,
} from '@mp/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createManualClock, createSeqIds } from '../adapters/fake/clock';
import { cs } from '../i18n/cs';
import { messageForCode } from '../i18n/messages';
import { ApiError, NetworkError, UploadAbortedError, UploadHttpError } from '../ports';
import {
  BACKOFF_MS,
  ENCODE_BUFFER,
  GROUP_IDLE_MS,
  PUT_PARALLEL,
  UPLOAD_PARALLEL,
  createUploadQueue,
  encodeConcurrencyFor,
  type UploadQueue,
} from './queue';
import type { EncodedPhoto, FileLike, QueueItem } from './types';

const flush = async () => {
  for (let i = 0; i < 60; i += 1) await Promise.resolve();
};

interface Harness {
  queue: UploadQueue;
  clock: ReturnType<typeof createManualClock>;
  log: {
    encodeStarted: string[];
    encodePeak: number;
    reserves: ReserveRequest[];
    puts: Array<{ photo: string; key: string; headers: Record<string, string>; target: Pick<UploadTarget, 'url' | 'method' | 'headers'> }>;
    putsAborted: number;
    photosPeak: number;
    putsPerPhotoPeak: number;
    bufferedPeak: number;
    commits: CommitRequest[];
    commitSignals: AbortSignal[];
  };
  hooks: {
    /** Throw to fail the nth PUT (1-based, per photo and file) attempt. */
    put?: (photo: string, file: string, attempt: number) => Error | undefined;
    encode?: (name: string) => Error | undefined;
    /** Decoded size the stub encoder reports (default 3000 x 2000). */
    size?: (name: string) => [number, number];
    reserve?: (photoId: string, call: number) => 'STORAGE_FULL' | 'FILE_TOO_LARGE' | undefined;
    reserveAll409?: boolean;
    commit?: (photo: string, attempt: number) => Error | undefined;
    putMs?: (photo: string) => number;
    /** A commit that takes this long (and can be aborted). */
    commitMs?: number;
    offline: boolean;
  };
  tick(ms: number, step?: number): Promise<void>;
  items(): QueueItem[];
  byName(name: string): QueueItem;
}

function files(n: number, prefix = 'IMG_'): FileLike[] {
  return Array.from({ length: n }, (_, i) => ({ name: `${prefix}${i + 1}.jpg`, size: 1000, type: 'image/jpeg', lastModified: i }));
}

function encodedFor(width: number, height: number): EncodedPhoto {
  const plan = variantPlan(width, height);
  const variants = {
    master: { w: plan.master.w, h: plan.master.h, bytes: 1000 },
    webp: plan.webp.map((e) => ({ tier: e.tier as 480, w: e.w, h: e.h, bytes: 200 })),
    jpeg: { w: plan.jpeg.w, h: plan.jpeg.h, bytes: 500 },
    og: { w: plan.og.w, h: plan.og.h, bytes: 300 },
  };
  const planned = planUploadFiles('dddddddd-0000-4000-8000-000000000000', width, height);
  const bytesOf = (kind: string) => (kind === 'master' ? 1000 : kind === 'webp' ? 200 : kind === 'jpeg' ? 500 : 300);
  return {
    width,
    height,
    dominantColor: '#336699',
    variants,
    files: planned.map((p) => ({
      kind: p.kind,
      ...(p.tier === undefined ? {} : { tier: p.tier }),
      bytes: bytesOf(p.kind),
      body: new Blob([new Uint8Array(bytesOf(p.kind))]),
    })),
  };
}

function setup(over: { encodeConcurrency?: number; maxFilesPerBatch?: number; encodeMs?: number; putMs?: number } = {}): Harness {
  const clock = createManualClock();
  const ids = createSeqIds();
  const encodeMs = over.encodeMs ?? 20;
  const putMsDefault = over.putMs ?? 30;
  let queue!: UploadQueue;
  const log: Harness['log'] = {
    encodeStarted: [],
    encodePeak: 0,
    reserves: [],
    puts: [],
    putsAborted: 0,
    photosPeak: 0,
    putsPerPhotoPeak: 0,
    bufferedPeak: 0,
    commits: [],
    commitSignals: [],
  };
  const hooks: Harness['hooks'] = { offline: false };
  let encoding = 0;
  const activePhotos = new Map<string, number>();
  const attempts = new Map<string, number>();
  const commitAttempts = new Map<string, number>();
  const reserveCalls = new Map<string, number>();

  queue = createUploadQueue({
    clock,
    ids,
    config: { maxFilesPerBatch: over.maxFilesPerBatch ?? 200, encodeConcurrency: over.encodeConcurrency ?? 2 },
    encoder: {
      async encode(file, signal, onPhase) {
        log.encodeStarted.push(file.name);
        encoding += 1;
        log.encodePeak = Math.max(log.encodePeak, encoding);
        try {
          onPhase?.('previews');
          await clock.sleep(encodeMs, signal);
          onPhase?.('detail');
          const error = hooks.encode?.(file.name);
          if (error) throw error;
          const [w, h] = hooks.size?.(file.name) ?? [3000, 2000];
          return encodedFor(w, h);
        } finally {
          encoding -= 1;
        }
      },
    },
    api: {
      async reserve(request) {
        ReserveRequestSchema.parse(request);
        log.reserves.push(request);
        if (hooks.offline) throw new NetworkError();
        const items = request.items.map((item) => {
          const call = (reserveCalls.get(item.photo_id) ?? 0) + 1;
          reserveCalls.set(item.photo_id, call);
          const refusal = hooks.reserveAll409 ? 'STORAGE_FULL' : hooks.reserve?.(item.photo_id, call);
          if (refusal) return { photo_id: item.photo_id, ok: false as const, code: refusal };
          return {
            photo_id: item.photo_id,
            ok: true as const,
            uploads: item.files.map((f) => ({
              kind: f.kind,
              ...(f.tier === undefined ? {} : { tier: f.tier }),
              key: `photos/${item.photo_id}/${f.kind}-${f.tier ?? 0}`,
              method: 'PUT' as const,
              url: `https://r2.test/${item.photo_id}/${f.kind}-${f.tier ?? 0}`,
              headers: { 'content-type': 'image/jpeg', 'content-length': String(f.bytes), 'cache-control': 'public, max-age=31536000, immutable' },
              expiresAt: new Date(clock.now() + 15 * 60_000).toISOString(),
            })),
          };
        });
        const response: ReserveResponse = { items, used_bytes: 0, reserved_bytes: 0, hard: 100, warn: 80, level: 'ok' };
        return response;
      },
      async commit(request, options) {
        CommitRequestSchema.parse(request);
        if (options?.signal) log.commitSignals.push(options.signal);
        if (hooks.commitMs !== undefined) {
          // Like the real adapter: an abort during the call surfaces as a NetworkError.
          await clock.sleep(hooks.commitMs, options?.signal).catch(() => {
            throw new NetworkError();
          });
        }
        const attempt = (commitAttempts.get(request.photo_id) ?? 0) + 1;
        commitAttempts.set(request.photo_id, attempt);
        const error = hooks.commit?.(request.photo_id, attempt);
        if (error) throw error;
        log.commits.push(request);
        const photo = {
          id: request.photo_id,
          album_id: request.album_id,
          master_key: `photos/${request.photo_id}/master`,
          width: request.width,
          height: request.height,
          variants: request.variants,
          bytes_total: request.bytes_total,
          dominant_color: request.dominant_color ?? null,
          alt: null,
          caption: null,
          sort: log.commits.length * 10,
          legacy_key: null,
          created_at: '2026-10-20T08:00:00.000Z',
          updated_at: '2026-10-20T08:00:00.000Z',
        };
        return { photo, already_existed: false };
      },
    },
    upload: {
      async put(target, body, options) {
        const photo = target.url.split('/')[3]!;
        const file = target.url.split('/')[4]!;
        const attemptKey = `${photo}/${file}`;
        const attempt = (attempts.get(attemptKey) ?? 0) + 1;
        attempts.set(attemptKey, attempt);
        log.puts.push({ photo, key: file, headers: target.headers, target });
        expect(body.size).toBeGreaterThan(0);
        const perPhoto = (activePhotos.get(photo) ?? 0) + 1;
        activePhotos.set(photo, perPhoto);
        log.photosPeak = Math.max(log.photosPeak, activePhotos.size);
        log.putsPerPhotoPeak = Math.max(log.putsPerPhotoPeak, perPhoto);
        const release = () => {
          const left = (activePhotos.get(photo) ?? 1) - 1;
          if (left <= 0) activePhotos.delete(photo);
          else activePhotos.set(photo, left);
        };
        try {
          if (hooks.offline) throw new NetworkError();
          const error = hooks.put?.(photo, file, attempt);
          if (error) throw error;
          await clock.sleep(hooks.putMs?.(photo) ?? putMsDefault, options?.signal).catch(() => {
            log.putsAborted += 1;
            throw new UploadAbortedError();
          });
          options?.onProgress?.(body.size, body.size);
        } finally {
          release();
        }
      },
    },
  });
  queue.subscribe(() => {
    const buffered = queue.getState().items.filter((i) => ['encoded', 'reserving', 'reserved'].includes(i.status)).length;
    log.bufferedPeak = Math.max(log.bufferedPeak, buffered);
  });

  return {
    queue,
    clock,
    log,
    hooks,
    async tick(ms, step = 50) {
      await flush();
      for (let t = 0; t < ms; t += step) {
        await clock.advance(Math.min(step, ms - t));
        await flush();
      }
    },
    items: () => queue.getState().items,
    byName: (name) => queue.getState().items.find((i) => i.name === name)!,
  };
}

const disposers: Array<() => void> = [];
function started(h: Harness) {
  disposers.push(() => h.queue.dispose());
  return h;
}
afterEach(() => {
  for (const d of disposers.splice(0)) d();
});

const statusCount = (h: Harness, status: string) => h.items().filter((i) => i.status === status).length;

describe('a full run', () => {
  it('40 files: at most 3 photos upload at once, 4 PUTs each, encode concurrency 2, buffer 3, commits in order', async () => {
    const h = started(setup({ encodeConcurrency: 2 }));
    const input = files(40);
    h.queue.add('bbbbbbbb-0000-4000-8000-000000000001', input);
    await h.tick(60_000);
    expect(statusCount(h, 'done')).toBe(40);
    expect(h.log.encodePeak).toBe(2);
    expect(h.log.photosPeak).toBe(UPLOAD_PARALLEL);
    expect(h.log.putsPerPhotoPeak).toBe(PUT_PARALLEL);
    expect(h.log.bufferedPeak).toBeLessThanOrEqual(ENCODE_BUFFER);
    // Commits strictly in selection order.
    const order = new Map(h.items().map((i) => [i.id, i.order] as const));
    expect(h.log.commits.map((c) => order.get(c.photo_id))).toEqual(Array.from({ length: 40 }, (_, i) => i));
    // Every file was PUT exactly once, to the URL it was given, with the signed headers untouched.
    expect(h.log.puts).toHaveLength(40 * 8); // master, 5 WebP tiers, 1600 JPEG, OG
    for (const p of h.log.puts) {
      expect(p.target.method).toBe('PUT');
      expect(p.target.headers['content-type']).toBe('image/jpeg');
      expect(p.target.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    }
  });

  it('encode concurrency 1 on touch devices', async () => {
    expect(encodeConcurrencyFor(true)).toBe(1);
    expect(encodeConcurrencyFor(false)).toBe(2);
    const h = started(setup({ encodeConcurrency: encodeConcurrencyFor(true) }));
    h.queue.add('bbbbbbbb-0000-4000-8000-000000000001', files(8));
    await h.tick(20_000);
    expect(statusCount(h, 'done')).toBe(8);
    expect(h.log.encodePeak).toBe(1);
  });

  it('reports the step of each photo', async () => {
    const h = started(setup({ putMs: 500 }));
    h.queue.add('bbbbbbbb-0000-4000-8000-000000000001', files(1));
    await h.tick(0);
    expect(h.items()[0]!.status).toBe('encoding');
    await h.tick(40);
    expect(h.items()[0]!.status).toBe('encoded');
    await h.tick(GROUP_IDLE_MS + 100);
    expect(['reserved', 'uploading']).toContain(h.items()[0]!.status);
    await h.tick(5_000);
    expect(h.items()[0]!.status).toBe('done');
    expect(h.items()[0]!.progress).toBe(1);
  });

  it('commit carries the colour, exact sizes and parses with the shared schema', async () => {
    const h = started(setup());
    h.queue.add('bbbbbbbb-0000-4000-8000-000000000001', files(1));
    await h.tick(5_000);
    const c = h.log.commits[0]!;
    expect(c.dominant_color).toBe('#336699');
    expect(c.bytes_total).toBe(1000 + 200 * 5 + 500 + 300);
    expect(c.album_id).toBe('bbbbbbbb-0000-4000-8000-000000000001');
  });
});

describe('reserve groups', () => {
  it('waits 1 s without a new encoded photo before reserving a small group', async () => {
    const h = started(setup());
    h.queue.add('bbbbbbbb-0000-4000-8000-000000000001', files(3));
    await h.tick(100); // encoded: concurrency 2 -> two done, third encoding
    expect(h.log.reserves).toHaveLength(0);
    await h.tick(GROUP_IDLE_MS - 200);
    expect(h.log.reserves).toHaveLength(0);
    await h.tick(400);
    expect(h.log.reserves).toHaveLength(1);
    expect(h.log.reserves[0]!.items).toHaveLength(3);
  });

  it('flushes at 10 photos without waiting, never above max_files_per_batch, albums never mixed', async () => {
    const h = started(setup({ encodeConcurrency: 2 }));
    h.queue.add('bbbbbbbb-0000-4000-8000-000000000001', files(30));
    await h.tick(60_000);
    expect(statusCount(h, 'done')).toBe(30);
    for (const r of h.log.reserves) expect(r.items.length).toBeLessThanOrEqual(10);

    const small = started(setup({ maxFilesPerBatch: 4 }));
    small.queue.add('bbbbbbbb-0000-4000-8000-000000000001', files(20));
    await small.tick(60_000);
    expect(statusCount(small, 'done')).toBe(20);
    for (const r of small.log.reserves) expect(r.items.length).toBeLessThanOrEqual(4);
    expect(Math.max(...small.log.reserves.map((r) => r.items.length))).toBe(3); // buffer of 3 limits the groups
  });

  it('a refused photo does not stop the others (first-fit)', async () => {
    const h = started(setup());
    h.queue.add('bbbbbbbb-0000-4000-8000-000000000001', files(5));
    const refused = 'dddddddd-0000-4000-8000-000000000002';
    h.hooks.reserve = (id) => (id === refused ? 'STORAGE_FULL' : undefined);
    await h.tick(20_000);
    expect(statusCount(h, 'done')).toBe(4);
    const bad = h.items().find((i) => i.id === refused)!;
    expect(bad.status).toBe('failed');
    expect(bad.failure).toMatchObject({ kind: 'storage-full', message: messageForCode('STORAGE_FULL') });
  });

  it('a whole-request STORAGE_FULL stops encoding and fails everything not yet uploading', async () => {
    const h = started(setup({ encodeConcurrency: 1 }));
    h.queue.add('bbbbbbbb-0000-4000-8000-000000000001', files(12));
    h.hooks.reserveAll409 = true;
    await h.tick(30_000);
    expect(h.log.encodeStarted.length).toBeLessThan(12);
    expect(statusCount(h, 'failed')).toBe(12);
    for (const i of h.items()) expect(i.failure?.message).toBe(messageForCode('STORAGE_FULL'));
    expect(h.log.puts).toHaveLength(0);
  });

  it('a thrown 409 STORAGE_FULL is treated the same way', async () => {
    const h = started(setup());
    h.queue.add('bbbbbbbb-0000-4000-8000-000000000001', files(3));
    h.hooks.reserve = () => {
      throw new ApiError('STORAGE_FULL');
    };
    await h.tick(10_000);
    expect(statusCount(h, 'failed')).toBe(3);
  });
});

describe('failures and retries', () => {
  it('network failures back off 1 s, 3 s, 9 s and then fail the photo', async () => {
    const h = started(setup({ putMs: 10 }));
    h.queue.add('bbbbbbbb-0000-4000-8000-000000000001', files(1));
    h.hooks.put = (_p, file) => (file === 'master-0' ? new NetworkError() : undefined);
    const masterPuts = () => h.log.puts.filter((p) => p.key === 'master-0').length;
    // The photo is reserved after the 1 s group wait; the master fails right away (t0), then 1 s, 3 s, 9 s later.
    while (masterPuts() === 0) await h.tick(10, 10);
    expect(BACKOFF_MS).toEqual([1000, 3000, 9000]);
    await h.tick(900, 10);
    expect(masterPuts()).toBe(1);
    await h.tick(200, 10); // t0 + 1.1 s
    expect(masterPuts()).toBe(2);
    await h.tick(2_800, 10); // t0 + 3.9 s: second wait (3 s) not over
    expect(masterPuts()).toBe(2);
    await h.tick(300, 10); // t0 + 4.2 s
    expect(masterPuts()).toBe(3);
    await h.tick(8_700, 10); // t0 + 12.9 s: third wait (9 s) not over
    expect(masterPuts()).toBe(3);
    await h.tick(300, 10); // t0 + 13.2 s
    expect(masterPuts()).toBe(4);
    const item = h.items()[0]!;
    expect(item.status).toBe('failed');
    expect(item.failure?.message).toBe(messageForCode('UPLOAD_FAILED'));
    expect(masterPuts()).toBe(4); // no fifth attempt
    expect(h.log.commits).toHaveLength(0);
  });

  it('a transient failure that clears is retried silently and the photo completes', async () => {
    const h = started(setup());
    h.queue.add('bbbbbbbb-0000-4000-8000-000000000001', files(2));
    h.hooks.put = (_p, file, attempt) => (file === 'og-0' && attempt === 1 ? new UploadHttpError(503) : undefined);
    await h.tick(30_000);
    expect(statusCount(h, 'done')).toBe(2);
  });

  it('never retries a 4xx except 401 and 429', async () => {
    const h = started(setup());
    h.queue.add('bbbbbbbb-0000-4000-8000-000000000001', files(2));
    h.hooks.put = (photo, file, attempt) => {
      if (photo === 'dddddddd-0000-4000-8000-000000000001' && file === 'jpeg-0') return new UploadHttpError(400);
      if (photo === 'dddddddd-0000-4000-8000-000000000002' && file === 'jpeg-0' && attempt === 1) return new UploadHttpError(429);
      return undefined;
    };
    await h.tick(30_000);
    expect(h.items()[0]!.status).toBe('failed');
    expect(h.log.puts.filter((p) => p.photo.endsWith('0001') && p.key === 'jpeg-0')).toHaveLength(1);
    expect(h.items()[1]!.status).toBe('done');
    expect(h.log.puts.filter((p) => p.photo.endsWith('0002') && p.key === 'jpeg-0')).toHaveLength(2);
  });

  it('a 4xx from commit fails once; 401 and 5xx are retried', async () => {
    const h = started(setup());
    h.queue.add('bbbbbbbb-0000-4000-8000-000000000001', files(3));
    let calls422 = 0;
    h.hooks.commit = (photo, attempt) => {
      if (photo.endsWith('0001')) {
        calls422 += 1;
        return new ApiError('KEY_MISMATCH');
      }
      if (photo.endsWith('0002') && attempt === 1) return new ApiError('UNAUTHENTICATED');
      if (photo.endsWith('0003') && attempt === 1) return new ApiError('UPSTREAM_ERROR');
      return undefined;
    };
    await h.tick(40_000);
    expect(calls422).toBe(1);
    expect(h.items()[0]!.status).toBe('failed');
    expect(h.items()[0]!.failure?.kind).toBe('commit');
    expect(h.items()[1]!.status).toBe('done');
    expect(h.items()[2]!.status).toBe('done');
  });

  it('a corrupt file fails with its text and the rest continue', async () => {
    const h = started(setup());
    h.queue.add('bbbbbbbb-0000-4000-8000-000000000001', files(4));
    h.hooks.encode = (name) => (name === 'IMG_2.jpg' ? new Error('decode') : undefined);
    await h.tick(20_000);
    expect(h.byName('IMG_2.jpg').failure).toEqual({ kind: 'corrupt', message: 'Fotku se nepodařilo zpracovat.' });
    expect(statusCount(h, 'done')).toBe(3);
  });

  it('failed photos are retried from scratch; a failed commit is repeated alone', async () => {
    const h = started(setup());
    h.queue.add('bbbbbbbb-0000-4000-8000-000000000001', files(2));
    h.hooks.encode = (name) => (name === 'IMG_1.jpg' ? new Error('decode') : undefined);
    h.hooks.commit = (photo, attempt) => (photo.endsWith('0002') && attempt === 1 ? new ApiError('INVALID_REQUEST') : undefined);
    await h.tick(20_000);
    expect(statusCount(h, 'failed')).toBe(2);
    const putsBefore = h.log.puts.length;
    h.hooks.encode = undefined;
    h.queue.retryFailed();
    await h.tick(20_000);
    expect(statusCount(h, 'done')).toBe(2);
    // IMG_2's retry only committed again: 8 PUTs for IMG_1 on top, none for IMG_2.
    expect(h.log.puts.length - putsBefore).toBe(8);
    expect(h.log.commits.map((c) => c.photo_id)).toEqual(['dddddddd-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000002']);
  });
});

describe('expired upload URL', () => {
  it('asks for new URLs once, silently, and finishes', async () => {
    const h = started(setup());
    h.queue.add('bbbbbbbb-0000-4000-8000-000000000001', files(1));
    h.hooks.put = (_p, file, attempt) => (file === 'master-0' && attempt === 1 ? new UploadHttpError(403) : undefined);
    await h.tick(30_000);
    expect(h.items()[0]!.status).toBe('done');
    expect(h.log.reserves).toHaveLength(2);
    expect(h.log.reserves[1]!.items).toHaveLength(1);
    expect(h.items()[0]!.failure).toBeNull();
  });

  it('a second 403 is handled as a network failure (backoff), not another re-reserve', async () => {
    const h = started(setup({ putMs: 10 }));
    h.queue.add('bbbbbbbb-0000-4000-8000-000000000001', files(1));
    h.hooks.put = (_p, file) => (file === 'master-0' ? new UploadHttpError(403) : undefined);
    await h.tick(40_000);
    expect(h.log.reserves).toHaveLength(2);
    expect(h.items()[0]!.status).toBe('failed');
    expect(h.log.puts.filter((p) => p.key === 'master-0')).toHaveLength(1 + 4);
  });
});

describe('offline', () => {
  it('pauses with "Čekám na připojení…" and resumes without using up attempts', async () => {
    const h = started(setup({ putMs: 200 }));
    h.queue.add('bbbbbbbb-0000-4000-8000-000000000001', files(4));
    await h.tick(1_300); // first photos uploading
    h.hooks.offline = true;
    h.queue.setOnline(false);
    await h.tick(30_000); // far beyond the whole backoff schedule
    const paused = h.items().filter((i) => i.paused);
    expect(paused.length).toBeGreaterThan(0);
    expect(cs.upload.waiting).toBe('Čekám na připojení…');
    expect(statusCount(h, 'failed')).toBe(0);
    expect(statusCount(h, 'done')).toBeLessThan(4);
    const putsWhileOffline = h.log.puts.length;
    await h.tick(5_000);
    expect(h.log.puts.length).toBe(putsWhileOffline);

    h.hooks.offline = false;
    h.queue.setOnline(true);
    await h.tick(30_000);
    expect(statusCount(h, 'done')).toBe(4);
    expect(h.items().some((i) => i.paused)).toBe(false);
  });

  it('does not start new reserves, uploads or commits while offline', async () => {
    const h = started(setup());
    h.queue.setOnline(false);
    h.queue.add('bbbbbbbb-0000-4000-8000-000000000001', files(3));
    await h.tick(10_000);
    expect(h.log.reserves).toHaveLength(0);
    expect(h.items().every((i) => i.status === 'encoded')).toBe(true);
    expect(h.items().every((i) => i.paused)).toBe(true);
    h.queue.setOnline(true);
    await h.tick(20_000);
    expect(statusCount(h, 'done')).toBe(3);
  });
});

describe('commit order', () => {
  it('commits in selection order even when a later photo finishes uploading first', async () => {
    const h = started(setup({ encodeConcurrency: 2 }));
    h.queue.add('bbbbbbbb-0000-4000-8000-000000000001', files(5));
    h.hooks.putMs = (photo) => (photo.endsWith('0001') ? 8_000 : 50);
    await h.tick(6_000);
    expect(h.log.commits).toHaveLength(0);
    expect(h.items().filter((i) => i.status === 'uploaded').length).toBeGreaterThan(0);
    await h.tick(20_000);
    expect(h.log.commits.map((c) => c.photo_id.slice(-4))).toEqual(['0001', '0002', '0003', '0004', '0005']);
  });

  it('a failed photo does not block the ones after it', async () => {
    const h = started(setup());
    h.queue.add('bbbbbbbb-0000-4000-8000-000000000001', files(3));
    h.hooks.encode = (name) => (name === 'IMG_1.jpg' ? new Error('x') : undefined);
    await h.tick(10_000);
    expect(h.log.commits.map((c) => c.photo_id.slice(-4))).toEqual(['0002', '0003']);
  });
});

describe('cancel', () => {
  it('aborts running PUTs, never commits and leaves the others alone', async () => {
    const h = started(setup({ putMs: 5_000 }));
    h.queue.add('bbbbbbbb-0000-4000-8000-000000000001', files(2));
    await h.tick(2_500);
    expect(statusCount(h, 'uploading')).toBe(2);
    const first = h.items()[0]!;
    h.queue.cancel(first.id);
    await h.tick(0);
    expect(h.log.putsAborted).toBe(PUT_PARALLEL);
    expect(h.items()[0]!.status).toBe('cancelled');
    await h.tick(20_000);
    expect(h.items()[1]!.status).toBe('done');
    expect(h.log.commits.map((c) => c.photo_id)).toEqual([h.items()[1]!.id]);
  });

  it('cancelAll stops everything, including encoding and queued photos', async () => {
    const h = started(setup({ encodeConcurrency: 1, encodeMs: 500 }));
    h.queue.add('bbbbbbbb-0000-4000-8000-000000000001', files(10));
    await h.tick(700);
    h.queue.cancelAll();
    await h.tick(30_000);
    expect(statusCount(h, 'cancelled')).toBe(10);
    expect(h.log.reserves).toHaveLength(0);
    expect(h.log.encodeStarted.length).toBeLessThan(10);
  });

  it('threads the photo signal into commit; cancelling aborts the commit in flight and it ends cancelled', async () => {
    const h = started(setup());
    h.hooks.commitMs = 5_000;
    h.queue.add('bbbbbbbb-0000-4000-8000-000000000001', files(1));
    await h.tick(4_000);
    expect(h.items()[0]!.status).toBe('committing');
    expect(h.log.commitSignals).toHaveLength(1);
    expect(h.log.commitSignals[0]!.aborted).toBe(false);
    h.queue.cancel(h.items()[0]!.id);
    await h.tick(0);
    expect(h.log.commitSignals[0]!.aborted).toBe(true);
    expect(h.items()[0]!.status).toBe('cancelled');
    expect(h.items()[0]!.failure).toBeNull();
    expect(h.log.commits).toHaveLength(0);
  });
});

describe('dispose', () => {
  it('leaves no timer behind: idle timer, backoff sleeps, encodes and PUT retries are all released', async () => {
    const h = setup({ encodeMs: 400, putMs: 5_000 });
    h.queue.add('bbbbbbbb-0000-4000-8000-000000000001', files(6));
    await h.tick(1_000); // some photos are encoding, an idle timer is running
    expect(h.clock.pending()).toBeGreaterThan(0);
    h.queue.dispose();
    await h.tick(0);
    expect(h.clock.pending()).toBe(0);
  });

  it('also after uploads started and a backoff sleep is pending', async () => {
    const h = setup({ putMs: 5_000 });
    h.hooks.put = (_p, _f, attempt) => (attempt === 1 ? new NetworkError() : undefined);
    h.queue.add('bbbbbbbb-0000-4000-8000-000000000001', files(3));
    await h.tick(2_500);
    expect(h.clock.pending()).toBeGreaterThan(0);
    h.queue.dispose();
    await h.tick(0);
    expect(h.clock.pending()).toBe(0);
  });
});

describe('browser without WebP', () => {
  const noWebp = () => Object.assign(new Error('NO_WEBP'), { code: 'NO_WEBP', userMessage: cs.encode.noWebp });

  it('3 files: one encode attempt, then every queued file fails at once with the same message', async () => {
    const h = started(setup({ encodeConcurrency: 1 }));
    h.hooks.encode = () => noWebp();
    h.queue.add('bbbbbbbb-0000-4000-8000-000000000001', files(3));
    await h.tick(2_000);
    expect(h.log.encodeStarted).toHaveLength(1);
    expect(statusCount(h, 'failed')).toBe(3);
    expect(new Set(h.items().map((i) => i.failure?.message))).toEqual(new Set([cs.encode.noWebp]));
    expect(h.items().every((i) => i.failure?.code === 'NO_WEBP')).toBe(true);
    expect(h.log.reserves).toHaveLength(0);
  });

  it('files added afterwards fail at once without an encode attempt; a retry tries once more', async () => {
    const h = started(setup({ encodeConcurrency: 1 }));
    h.hooks.encode = () => noWebp();
    h.queue.add('bbbbbbbb-0000-4000-8000-000000000001', files(1));
    await h.tick(1_000);
    h.queue.add('bbbbbbbb-0000-4000-8000-000000000001', files(2, 'LATER_'));
    await h.tick(100);
    expect(h.log.encodeStarted).toHaveLength(1);
    expect(statusCount(h, 'failed')).toBe(3);

    h.hooks.encode = undefined; // the browser can do it now
    h.queue.retryFailed();
    await h.tick(20_000);
    expect(statusCount(h, 'done')).toBe(3);
  });
});

describe('T-268 phases, small photos, refusals', () => {
  it('an encoding row goes previews -> detail, and the phase is cleared once it is encoded', async () => {
    const h = started(setup({ encodeMs: 100 }));
    h.queue.add('bbbbbbbb-0000-4000-8000-000000000001', files(1));
    await h.tick(10, 10);
    expect(h.byName('IMG_1.jpg')).toMatchObject({ status: 'encoding', phase: 'previews' });
    await h.tick(150, 10);
    expect(h.byName('IMG_1.jpg').phase).not.toBe('previews');
    await h.tick(20_000);
    expect(h.byName('IMG_1.jpg')).toMatchObject({ status: 'done', phase: null });
  });

  it('a source under 2000 px long edge is warned about, not blocked, and still uploads', async () => {
    const h = started(setup());
    h.hooks.size = (name) => (name === 'IMG_1.jpg' ? [1600, 1200] : name === 'IMG_2.jpg' ? [2000, 1500] : [1200, 1600]);
    h.queue.add('bbbbbbbb-0000-4000-8000-000000000001', files(3));
    await h.tick(20_000);
    expect(h.byName('IMG_1.jpg').smallEdge).toBe(1600);
    expect(h.byName('IMG_2.jpg').smallEdge).toBeNull(); // exactly the minimum is fine
    expect(h.byName('IMG_3.jpg').smallEdge).toBe(1600); // portrait: the long edge counts
    expect(statusCount(h, 'done')).toBe(3);
  });

  it('refusals (too big, too many pixels) fail as "refused", are not retried in bulk and keep the other files going', async () => {
    const h = started(setup());
    const refuse = (code: string) => Object.assign(new Error(code), { code, userMessage: cs.encode[code === 'TOO_LARGE' ? 'tooLarge' : 'tooManyPixels'] });
    h.hooks.encode = (name) => (name === 'IMG_1.jpg' ? refuse('TOO_LARGE') : name === 'IMG_2.jpg' ? refuse('TOO_MANY_PIXELS') : undefined);
    h.queue.add('bbbbbbbb-0000-4000-8000-000000000001', files(3));
    await h.tick(20_000);
    expect(h.byName('IMG_1.jpg').failure).toEqual({ kind: 'refused', message: cs.encode.tooLarge, code: 'TOO_LARGE' });
    expect(h.byName('IMG_2.jpg').failure).toEqual({ kind: 'refused', message: cs.encode.tooManyPixels, code: 'TOO_MANY_PIXELS' });
    expect(h.byName('IMG_3.jpg').status).toBe('done');
    expect(h.log.reserves.flatMap((r) => r.items)).toHaveLength(1); // nothing reached the network for the refused files
    h.hooks.encode = undefined;
    h.queue.retryFailed();
    await h.tick(5_000);
    expect(statusCount(h, 'failed')).toBe(2);
  });
});
