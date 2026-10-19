import { describe, expect, it } from 'vitest';
import {
  createMasterStore,
  createZoom,
  loadDecoded,
  prefetchFit,
  STATUS_FAILED,
  STATUS_LOADING,
  zoomKeyAction,
  type ImageLike,
  type PhotoInfo,
  type ZoomParts,
} from './lightbox-zoom';

/** Fake image: records what was assigned; decode() resolves/rejects when the test says so. */
class FakeImage implements ImageLike {
  src = '';
  srcset = '';
  sizes = '';
  settle!: (ok: boolean) => void;
  private readonly done = new Promise<void>((res, rej) => {
    this.settle = (ok) => (ok ? res() : rej(new Error('EncodingError')));
  });
  get currentSrc(): string {
    return this.src || this.srcset.split(',')[0]!.trim().split(' ')[0]!;
  }
  decode(): Promise<void> {
    return this.done;
  }
}

function factory(auto: (img: FakeImage) => boolean | null = () => true) {
  const made: FakeImage[] = [];
  const create = () => {
    const img = new FakeImage();
    made.push(img);
    const verdict = auto(img);
    // The verdict is applied once the test has finished assigning src/srcset (next microtask).
    if (verdict !== null) queueMicrotask(() => img.settle(verdict));
    return img;
  };
  return { made, create };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

const photo = (n: number, masterWidth = 3000): PhotoInfo => ({
  fitSet: `https://i/${n}-1600.webp 1600w, https://i/${n}-2400.webp 2400w`,
  href: `https://i/${n}-1600.jpg`,
  masterUrl: `https://i/${n}-master.jpg`,
  masterWidth,
  masterHeight: masterWidth * (2 / 3),
});

function fakeParts(): ZoomParts & { styles: Record<string, string> } {
  const attrs = new Map<string, string>();
  const styles: Record<string, string> = {};
  const el = (extra: object = {}) =>
    ({
      hidden: false,
      textContent: '',
      setAttribute: (k: string, v: string) => void attrs.set(k, v),
      removeAttribute: () => {},
      toggleAttribute: () => true,
      ...extra,
    }) as never;
  const image = () => {
    const o = {
      hidden: true,
      src: '',
      offsetWidth: 1000,
      offsetHeight: 800,
      removeAttribute(k: string) {
        if (k === 'src') o.src = '';
      },
    };
    return o as unknown as HTMLImageElement;
  };
  return {
    styles,
    stage: el({
      clientWidth: 1000,
      clientHeight: 800,
      style: { setProperty: (k: string, v: string) => (styles[k] = v) },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 800 }),
    }),
    front: image(),
    back: image(),
    status: el(),
    group: el(),
    zoomIn: el(),
    zoomOut: el(),
    zoomFit: el(),
  };
}

describe('loadDecoded', () => {
  it('sets sizes and srcset, then waits for decode', async () => {
    const { made, create } = factory();
    const img = await loadDecoded(create, { srcset: 'a 1600w', sizes: '100vw' });
    expect(made).toHaveLength(1);
    expect(img.sizes).toBe('100vw');
    expect(img.srcset).toBe('a 1600w');
  });

  it('rejects when decode fails', async () => {
    const { create } = factory(() => false);
    await expect(loadDecoded(create, { src: 'x' })).rejects.toThrow();
  });
});

describe('master store', () => {
  it('requests a master once, however often it is asked', async () => {
    const { made, create } = factory();
    const store = createMasterStore(create);
    const [a, b] = await Promise.all([store.request('m1'), store.request('m1')]);
    expect(a).toBe(b);
    await store.request('m1');
    expect(made).toHaveLength(1);
    expect(store.has('m1')).toBe(true);
  });

  it('keeps only one master: another photo drops the first', async () => {
    const { made, create } = factory();
    const store = createMasterStore(create);
    await store.request('m1');
    await store.request('m2');
    expect(store.has('m1')).toBe(false);
    expect(store.has('m2')).toBe(true);
    expect(made).toHaveLength(2);
  });

  it('resolves null on failure and allows a retry', async () => {
    let ok = false;
    const { made, create } = factory(() => ok);
    const store = createMasterStore(create);
    expect(await store.request('m1')).toBeNull();
    ok = true;
    expect(await store.request('m1')).not.toBeNull();
    expect(made).toHaveLength(2);
  });
});

describe('prefetch', () => {
  const near = [photo(1), photo(3)];

  it('prefetches the fit candidate only, never the master', () => {
    const { made, create } = factory(() => null);
    prefetchFit(create, near, {});
    expect(made.map((i) => i.srcset)).toEqual(near.map((p) => p.fitSet));
    expect(made.every((i) => i.sizes === '100vw')).toBe(true);
    expect(made.some((i) => i.src.includes('master') || i.srcset.includes('master'))).toBe(false);
  });

  it('does nothing under saveData', () => {
    const { made, create } = factory(() => null);
    expect(prefetchFit(create, near, { saveData: true })).toEqual([]);
    expect(made).toHaveLength(0);
  });
});

describe('zoom keys', () => {
  it('maps + - 0 and ignores modified keys', () => {
    expect(zoomKeyAction({ key: '+' })).toBe('in');
    expect(zoomKeyAction({ key: '-' })).toBe('out');
    expect(zoomKeyAction({ key: '0' })).toBe('fit');
    expect(zoomKeyAction({ key: '+', ctrlKey: true })).toBeNull();
    expect(zoomKeyAction({ key: 'ArrowLeft' })).toBeNull();
  });
});

describe('zoom controller staged loading', () => {
  it('shows the thumbnail at once, requests only the fit tier on open, swaps after decode', async () => {
    const { made, create } = factory(() => null);
    const parts = fakeParts();
    const zoom = createZoom(parts, { create });
    expect(made).toHaveLength(0); // nothing before the lightbox is opened
    zoom.show(photo(1), 'https://i/1-480.webp');
    expect(parts.back.src).toBe('https://i/1-480.webp');
    expect(parts.back.hidden).toBe(false);
    expect(parts.front.src).toBe(''); // no blank-frame swap yet
    expect(made).toHaveLength(1);
    expect(made[0]!.srcset).toContain('1600w');
    expect(made.some((i) => i.src.includes('master'))).toBe(false);
    made[0]!.settle(true);
    await flush();
    expect(parts.front.src).toBe('https://i/1-1600.webp');
    expect(parts.back.hidden).toBe(true);
  });

  it('first zoom loads the master once, with a status that is then cleared; close drops it, reopen asks again', async () => {
    const { made, create } = factory(() => null);
    const parts = fakeParts();
    const zoom = createZoom(parts, { create });
    zoom.show(photo(1), 'thumb');
    made[0]!.settle(true);
    await flush();
    expect(parts.group.hidden).toBe(false); // headroom: 3000 px master over a 1000 px fit box
    zoom.zoomIn();
    expect(parts.status.textContent).toBe(STATUS_LOADING);
    zoom.zoomIn(); // a second action while loading must not request again
    expect(made.filter((i) => i.src.includes('master'))).toHaveLength(1);
    made[1]!.settle(true);
    await flush();
    expect(parts.status.textContent).toBe('');
    expect(parts.front.src).toBe('https://i/1-master.jpg');
    zoom.close();
    zoom.show(photo(1), 'thumb'); // reopen
    made[2]!.settle(true); // the fit tier again (browser cache)
    await flush();
    expect(parts.front.src).toBe('https://i/1-1600.webp'); // reopened at fit
    zoom.zoomIn();
    // The decoded master was dropped on close, so the browser is asked again (answered by its HTTP cache).
    const masters = made.filter((i) => i.src.includes('master'));
    expect(masters).toHaveLength(2);
    masters[1]!.settle(true);
    await flush();
    expect(parts.front.src).toBe('https://i/1-master.jpg');
  });

  it('holds no master after close', async () => {
    const { made, create } = factory(() => null);
    const parts = fakeParts();
    const zoom = createZoom(parts, { create });
    zoom.show(photo(1), 'thumb');
    made[0]!.settle(true);
    await flush();
    zoom.zoomIn();
    made[1]!.settle(true);
    await flush();
    zoom.close();
    zoom.show(photo(1), 'thumb');
    zoom.zoomIn();
    expect(parts.status.textContent).toBe(STATUS_LOADING); // not held any more: a load starts
  });

  it('keeps the fit view with a note when the master fails, and zoom still works', async () => {
    const { made, create } = factory(() => null);
    const parts = fakeParts();
    const zoom = createZoom(parts, { create });
    zoom.show(photo(1), 'thumb');
    made[0]!.settle(true);
    await flush();
    zoom.zoomIn();
    made[1]!.settle(false);
    await flush();
    expect(parts.status.textContent).toBe(STATUS_FAILED);
    expect(parts.front.src).toBe('https://i/1-1600.webp');
    expect(zoom.view.scale).toBeGreaterThan(1);
    zoom.zoomIn();
    expect(zoom.view.scale).toBeGreaterThan(1.5);
  });

  it('hides the zoom group when the master gives no headroom', async () => {
    const { made, create } = factory(() => null);
    const parts = fakeParts();
    const zoom = createZoom(parts, { create });
    zoom.show(photo(1, 1000), 'thumb'); // master as wide as the fit box
    made[0]!.settle(true);
    await flush();
    expect(parts.group.hidden).toBe(true);
    zoom.zoomIn();
    expect(zoom.view.scale).toBe(1);
    expect(made.filter((i) => i.src.includes('master'))).toHaveLength(0);
  });

  it('ignores a decode that finishes after the photo changed and drops the old master', async () => {
    const { made, create } = factory(() => null);
    const parts = fakeParts();
    const zoom = createZoom(parts, { create });
    zoom.show(photo(1), 'thumb');
    made[0]!.settle(true);
    await flush();
    zoom.zoomIn(); // master of photo 1 pending
    zoom.show(photo(2), 'thumb2'); // photo change: back to fit, master 1 dropped
    made[1]!.settle(true); // late master 1
    made[2]!.settle(true); // fit of photo 2
    await flush();
    expect(parts.front.src).toBe('https://i/2-1600.webp');
    expect(zoom.view.scale).toBe(1);
    expect(parts.status.textContent).toBe('');
  });

  it('double click zooms at the pointer and a second one returns to fit', async () => {
    const { made, create } = factory(() => null);
    const parts = fakeParts();
    const zoom = createZoom(parts, { create });
    zoom.show(photo(1), 'thumb');
    made[0]!.settle(true);
    await flush();
    zoom.toggleAt(700, 400);
    expect(zoom.view.scale).toBe(2);
    zoom.toggleAt(700, 400);
    expect(zoom.view.scale).toBe(1);
  });
});
