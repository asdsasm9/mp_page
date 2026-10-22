// Local Node benchmark for the publish step (WP4-19). Indicative only: this is Node on a dev
// machine, NOT the Cloudflare Workers runtime. It says nothing about Worker CPU limits.
// Run: npm run bench:snapshot
import { SnapshotSchema, buildSnapshot } from '@mp/shared';
import { syntheticCatalog } from '../apps/api/test/synthetic-catalog';

const PHOTOS = 4000;
const RUNS = 7;
const rows = syntheticCatalog({ photos: PHOTOS, redirects: 200 });
const now = new Date('2026-10-19T12:00:00.000Z');

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
function time<T>(fn: () => T): { ms: number; value: T } {
  const t0 = performance.now();
  const value = fn();
  return { ms: performance.now() - t0, value };
}

// Warm-up so JIT compilation is not counted as the steady state; the first run is reported too.
const first = time(() => buildSnapshot(rows, now));
const build: number[] = [first.ms];
const stringify: number[] = [];
const parse: number[] = [];
let json = '';
for (let i = 0; i < RUNS; i++) {
  const b = time(() => buildSnapshot(rows, now));
  build.push(b.ms);
  const s = time(() => JSON.stringify(b.value));
  stringify.push(s.ms);
  json = s.value;
  const p = time(() => SnapshotSchema.parse(JSON.parse(json)));
  parse.push(p.ms);
}

const bytes = Buffer.byteLength(json, 'utf8');
const f = (n: number) => n.toFixed(1);
console.log(`runtime: Node ${process.version} (NOT the Workers runtime; indicative only)`);
console.log(`photos: ${PHOTOS}, albums: ${first.value.counts.albums}, categories: ${first.value.counts.categories}`);
console.log(`snapshot size: ${bytes} bytes (${(bytes / 1024 / 1024).toFixed(2)} MiB), limit 6 MiB`);
console.log(`buildSnapshot (includes one SnapshotSchema.parse): first ${f(first.ms)} ms, median ${f(median(build))} ms`);
console.log(`JSON.stringify: median ${f(median(stringify))} ms`);
console.log(`JSON.parse + full SnapshotSchema.parse: median ${f(median(parse))} ms`);
