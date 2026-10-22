import { SnapshotSchema, type Snapshot } from '@mp/shared';
import fixture from '../../../../../packages/shared/fixtures/snapshot.fixture.json';

/** The shared snapshot fixture (13 albums, 141 photos), validated on load. */
export function fixtureSnapshot(): Snapshot {
  return SnapshotSchema.parse(fixture);
}
