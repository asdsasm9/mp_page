import { describe, expect, it } from 'vitest';
import { SnapshotSchema } from '@mp/shared';
import fixtureJson from '../../../../packages/shared/fixtures/snapshot.fixture.json';
import { buildLlmsTxt } from './llms';

describe('buildLlmsTxt', () => {
  const fixture = SnapshotSchema.parse(fixtureJson);
  const text = buildLlmsTxt(fixture.categories);

  it('starts with the brand heading and names Brno', () => {
    expect(text.startsWith('# Mullny Photos\n')).toBe(true);
    expect(text).toContain('Brn');
  });

  it('links every category on the production origin', () => {
    for (const c of fixture.categories) expect(text).toContain(`(https://www.mullnyphotos.cz/${c.slug}/)`);
  });

  it('lists the About and Contact sections of the home page, not the removed pages', () => {
    expect(text).toContain('(https://www.mullnyphotos.cz/#o-mne)');
    expect(text).toContain('(https://www.mullnyphotos.cz/#kontakt)');
    expect(text).not.toContain('/o-mne/');
    expect(text).not.toContain('/kontakt/');
  });

  it('states no price or phone', () => {
    expect(text).not.toMatch(/priceRange|\bKč\b|\bCZK\b|telefon|\+420/i);
  });
});
