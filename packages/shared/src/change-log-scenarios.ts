/**
 * Shared scenarios for the change_log semantics (T-251, T-256). One table, two consumers: the SQL trigger
 * log_change (supabase/tests/change-log.test.ts, PGlite) and the in-memory fake (apps/admin
 * src/adapters/fake/changes.test.ts). Each consumer maps these abstract operations onto its own API, so a
 * semantic change must be made in the table and both implementations, or a suite fails.
 *
 * Baseline (published, log empty): categories svatby "Svatby" and portrety "Portréty"; album one "První"
 * in svatby and album two "Druhé" in portrety; photo P1 in album one with alt "Nevěsta".
 * New refs a scenario may create: P2, three, rodina.
 */

export type ScenarioOp =
  | { op: 'addCategory'; ref: string; name: string }
  | { op: 'addAlbum'; ref: string; category: string; title: string }
  | { op: 'addPhoto'; ref: string; album: string; alt?: string }
  | { op: 'setCategory'; ref: string; set: { name: string } }
  | { op: 'setAlbum'; ref: string; set: { title?: string; sort?: number; slug?: string; cover?: string | null } }
  | { op: 'setPhoto'; ref: string; set: { alt?: string; caption?: string; sort?: number; album?: string } }
  | { op: 'deletePhoto'; ref: string };

/** [table, kind, label, category_name, album_title] in creation order of the lines (change_log.id ascending). */
export type ScenarioLine = readonly [table: string, kind: string, label: string, category: string | null, album: string | null];

export interface ChangeScenario {
  name: string;
  ops: readonly ScenarioOp[];
  lines: readonly ScenarioLine[];
}

export const CHANGE_SCENARIOS: readonly ChangeScenario[] = [
  {
    name: 'inserts are added with name and grouping context',
    ops: [
      { op: 'addPhoto', ref: 'P2', album: 'two', alt: 'Pár na louce' },
      { op: 'addAlbum', ref: 'three', category: 'svatby', title: 'Třetí' },
      { op: 'addCategory', ref: 'rodina', name: 'Rodina' },
    ],
    lines: [
      ['photos', 'added', 'Pár na louce', 'Portréty', 'Druhé'],
      ['albums', 'added', 'Třetí', 'Svatby', 'Třetí'],
      ['categories', 'added', 'Rodina', 'Rodina', null],
    ],
  },
  {
    name: 'a photo without alt text or caption has an empty label',
    ops: [{ op: 'addPhoto', ref: 'P2', album: 'one' }],
    lines: [['photos', 'added', '', 'Svatby', 'První']],
  },
  {
    name: 'a caption is the label fallback',
    ops: [
      { op: 'addPhoto', ref: 'P2', album: 'one' },
      { op: 'setPhoto', ref: 'P2', set: { caption: 'Podpis' } },
    ],
    lines: [['photos', 'added', 'Podpis', 'Svatby', 'První']],
  },
  {
    name: 'an update of only sort is reordered',
    ops: [
      { op: 'setAlbum', ref: 'one', set: { sort: 5 } },
      { op: 'setPhoto', ref: 'P1', set: { sort: 5 } },
    ],
    lines: [
      ['albums', 'reordered', 'První', 'Svatby', 'První'],
      ['photos', 'reordered', 'Nevěsta', 'Svatby', 'První'],
    ],
  },
  {
    name: 'any other column besides sort makes it edited',
    ops: [
      { op: 'setAlbum', ref: 'one', set: { sort: 5 } },
      { op: 'setPhoto', ref: 'P1', set: { sort: 5 } },
      { op: 'setAlbum', ref: 'one', set: { title: 'První nově', sort: 6 } },
    ],
    lines: [
      ['albums', 'edited', 'První nově', 'Svatby', 'První nově'],
      ['photos', 'reordered', 'Nevěsta', 'Svatby', 'První'],
    ],
  },
  {
    name: 'an update that changes no value is not logged',
    ops: [
      { op: 'setAlbum', ref: 'one', set: { title: 'První', sort: 0 } },
      { op: 'setPhoto', ref: 'P1', set: { alt: 'Nevěsta' } },
    ],
    lines: [],
  },
  {
    name: 'moving a photo to another album is edited and carries the new album',
    ops: [{ op: 'setPhoto', ref: 'P1', set: { album: 'two' } }],
    lines: [['photos', 'edited', 'Nevěsta', 'Portréty', 'Druhé']],
  },
  {
    name: 'deleting a published row is deleted, with the name at change time',
    ops: [{ op: 'deletePhoto', ref: 'P1' }],
    lines: [['photos', 'deleted', 'Nevěsta', 'Svatby', 'První']],
  },
  {
    name: 'a slug change is one edited album line',
    ops: [{ op: 'setAlbum', ref: 'one', set: { slug: 'one-new' } }],
    lines: [['albums', 'edited', 'První', 'Svatby', 'První']],
  },
  {
    name: 'repeated edits keep one line with the latest label',
    ops: [
      { op: 'setAlbum', ref: 'one', set: { title: 'A' } },
      { op: 'setAlbum', ref: 'one', set: { title: 'B' } },
    ],
    lines: [['albums', 'edited', 'B', 'Svatby', 'B']],
  },
  {
    name: 'added stays added when edited or reordered afterwards',
    ops: [
      { op: 'addPhoto', ref: 'P2', album: 'one' },
      { op: 'setPhoto', ref: 'P2', set: { alt: 'x' } },
      { op: 'setPhoto', ref: 'P2', set: { sort: 3 } },
    ],
    lines: [['photos', 'added', 'x', 'Svatby', 'První']],
  },
  {
    name: 'reordered becomes edited after a content edit and stays edited after a reorder',
    ops: [
      { op: 'setPhoto', ref: 'P1', set: { sort: 3 } },
      { op: 'setPhoto', ref: 'P1', set: { alt: 'y' } },
      { op: 'setPhoto', ref: 'P1', set: { sort: 4 } },
    ],
    lines: [['photos', 'edited', 'y', 'Svatby', 'První']],
  },
  {
    name: 'a row added and deleted before publishing leaves no line',
    ops: [
      { op: 'addPhoto', ref: 'P2', album: 'one' },
      { op: 'deletePhoto', ref: 'P2' },
    ],
    lines: [],
  },
  {
    name: 'a published row that was edited and then deleted is one deleted line',
    ops: [
      { op: 'setPhoto', ref: 'P1', set: { alt: 'z' } },
      { op: 'deletePhoto', ref: 'P1' },
    ],
    lines: [['photos', 'deleted', 'z', 'Svatby', 'První']],
  },
  {
    name: 'deleting the cover photo shows the album as edited',
    ops: [
      { op: 'setAlbum', ref: 'one', set: { cover: 'P1' } },
      { op: 'deletePhoto', ref: 'P1' },
    ],
    lines: [
      ['albums', 'edited', 'První', 'Svatby', 'První'],
      ['photos', 'deleted', 'Nevěsta', 'Svatby', 'První'],
    ],
  },
  {
    name: 'one line per distinct changed row, however often it changed',
    ops: [
      { op: 'setAlbum', ref: 'one', set: { title: 'a' } },
      { op: 'setAlbum', ref: 'one', set: { title: 'b' } },
      { op: 'setCategory', ref: 'svatby', set: { name: 'S' } },
      { op: 'addPhoto', ref: 'P2', album: 'two' },
    ],
    lines: [
      ['albums', 'edited', 'b', 'Svatby', 'b'],
      ['categories', 'edited', 'S', 'S', null],
      ['photos', 'added', '', 'Portréty', 'Druhé'],
    ],
  },
];
