/** Goal 20 (docs/ADMIN-UX.md section 9): page texts are not editable, there is no screen or link for them. */
import { cleanup, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { cs } from '../i18n/cs';
import { heading1, makeWorld, mount } from './helpers';

afterEach(cleanup);

describe('goal 20: no page-text editor', () => {
  it('the route table is exactly the information architecture of ADMIN-UX section 2', () => {
    const source = readFileSync(`${import.meta.dirname}/../App.tsx`, 'utf8');
    const paths = [...source.matchAll(/path="([^"]+)"/g)].map((m) => m[1]).sort();
    expect(paths).toEqual(
      [
        '*',
        '/',
        '/alba/:id',
        '/alba/:id/foto/:photoId',
        '/kategorie/:id',
        '/nahravani',
        '/prihlaseni',
        '/ulozeni',
        '/uvodni-stranka', // T-286: choose the home hero photo; a setting, not a page-text editor
        '/zverejnit',
      ].sort(),
    );
  });

  it('no link, button or heading in the shell, categories or publish screens offers to edit page texts', async () => {
    const forbidden = /texty|text(y|ů) (webu|stránek)|stránk|domů|o mně|kontakt|služby|editor/i;
    for (const path of ['/', '/zverejnit', '/ulozeni', '/nahravani']) {
      mount(makeWorld(), path);
      await screen.findByRole('heading', { level: 1 });
      await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
      // The one allowed link is "Úvodní stránka" (T-286): it opens the hero photo setting, not a text editor.
      const names = [...document.querySelectorAll('a, button, h1, h2, h3')]
        .map((el) => el.textContent ?? '')
        .filter((n) => n !== cs.nav.homePage);
      expect(names.filter((n) => forbidden.test(n)), path).toEqual([]);
      cleanup();
    }
  });

  it('the Czech dictionary has no label for such a screen', () => {
    const titles = Object.entries(cs.routes)
      .filter(([key]) => key !== 'homePage') // T-286: the hero photo setting, not a page-text editor
      .map(([, r]) => r.title);
    expect(titles.filter((t) => /text|stránk|obsah/i.test(t))).toEqual([]);
    expect(Object.keys(cs.routes).sort()).toEqual(['album', 'categories', 'category', 'homePage', 'login', 'photo', 'publish', 'storage', 'upload']);
  });

  it('an unknown address such as /texty is a plain "not found"', async () => {
    mount(makeWorld(), '/texty');
    await heading1(cs.notFound.title);
  });
});
