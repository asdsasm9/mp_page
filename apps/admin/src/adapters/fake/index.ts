/**
 * Entry of the fake backend. Only reachable through the guarded dynamic import in ../select.ts, and only
 * when the build has VITE_BACKEND=fake. The marker keeps this module identifiable in a bundle.
 */
import { systemClock, systemIds, type Ports } from '../../ports';
import { fixtureSnapshot } from './fixture';
import { FAKE_WORLD_MARKER } from './marker';
import { withQualityExamples } from './qualityExamples';
import { createFakeWorld, type FakeWorld } from './world';

export { FAKE_WORLD_MARKER } from './marker';
export { createFakeWorld, type FakeWorld, type FakeWorldOptions, type WorldSnapshot } from './world';
export { createManualClock, createSeqIds, type ManualClock } from './clock';
export { FAKE_ADMIN, FAKE_OUTSIDER } from './auth';
export { fixtureSnapshot } from './fixture';
export { withQualityExamples, exampleVariants } from './qualityExamples';

/** A world seeded from the fixture, on the real clock. Exposed on globalThis so browser checks can inject failures. */
export function createFakePorts(): Ports {
  const world: FakeWorld = createFakeWorld({ clock: systemClock, ids: systemIds, seed: withQualityExamples(fixtureSnapshot()) });
  (globalThis as Record<string, unknown>)[FAKE_WORLD_MARKER] = world;
  return world.ports;
}
