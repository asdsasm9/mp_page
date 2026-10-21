/** README.md: required sections, resolvable links, real npm scripts, a numbered cutover list, no copied doc text. */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { headingAnchors } from './gates-docs.mjs';

const root = `${import.meta.dirname}/..`;
const readmePath = `${root}/README.md`;
const readme = readFileSync(readmePath, 'utf8');
const lines = readme.split('\n');
const pkg = JSON.parse(readFileSync(`${root}/package.json`, 'utf8')) as { scripts: Record<string, string> };

const section = (text: string, title: string): string[] => {
  const all = text.split('\n');
  const start = all.findIndex((l) => /^#{2,3} /.test(l) && l.replace(/^#+ /, '').trim() === title);
  expect(start, `heading ${title}`).toBeGreaterThanOrEqual(0);
  const rest = all.slice(start + 1);
  const end = rest.findIndex((l) => /^#{1,3} /.test(l));
  return end === -1 ? rest : rest.slice(0, end);
};

const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();

describe('README.md', () => {
  it('has the required headings and mentions H-5', () => {
    const headings = lines.filter((l) => l.startsWith('## ')).map((l) => l.slice(3).trim());
    for (const h of ['Run', 'Test', 'Deploy', 'Cutover', 'Maintenance', 'Environment']) {
      expect(headings, h).toContain(h);
    }
    expect(readme).toContain('H-5');
  });

  it('stays about one page and has no stale env sentence', () => {
    expect(lines.length).toBeLessThanOrEqual(170);
    expect(readme).not.toMatch(/3 variables|only `PUBLIC_SITE_ENV`|never deployed from/i);
  });

  it('every relative link and anchor resolves', () => {
    const links = [...readme.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]!).filter((l) => !/^https?:/.test(l));
    expect(links.length).toBeGreaterThanOrEqual(15);
    for (const link of links) {
      const [file, anchor] = link.split('#') as [string, string | undefined];
      const target = file === '' ? readmePath : resolve(dirname(readmePath), file);
      expect(existsSync(target), link).toBe(true);
      if (anchor !== undefined) {
        expect([...headingAnchors(readFileSync(target, 'utf8'))], link).toContain(anchor);
      }
    }
  });

  it('every `npm run X` named exists in package.json scripts', () => {
    // `npm run X -w <workspace>` names a workspace script, checked by that workspace; skip it here
    const names = [...readme.matchAll(/npm run ([A-Za-z0-9:_-]+)/g)]
      .filter((m) => !/^ -w$/.test(readme.slice(m.index! + m[0].length, m.index! + m[0].length + 3)))
      .map((m) => m[1]!);
    expect(names.length).toBeGreaterThanOrEqual(12);
    for (const name of names) expect(pkg.scripts, name).toHaveProperty([name]);
    for (const name of ['design-check', 'admin-check', 'admin-prod-check', 'admin-encode-check', 'lightbox-a11y', 'lightbox-network', 'image-fit']) {
      expect(names, name).toContain(name);
    }
  });

  it('never puts variables before a command', () => {
    expect(readme).not.toMatch(/\b[A-Z][A-Z0-9_]{3,}=\S+\s+npm /);
  });

  it('has a numbered cutover list of at least 10 steps with H-5, rollback and H-ids', () => {
    const body = section(readme, 'Cutover');
    const items = body.filter((l) => /^\d+\. /.test(l));
    expect(items.length).toBeGreaterThanOrEqual(10);
    const text = body.join('\n');
    expect(text).toContain('H-5');
    expect(text).toMatch(/Rollback/);
    for (const h of ['H-2', 'H-6', 'H-7', 'H-10', 'H-11']) expect(text, h).toContain(h);
    expect(text).toMatch(/MX/);
    expect(text).toMatch(/Search Console/);
    expect(text).toMatch(/github\.io/);
    expect(text).toMatch(/gh-pages/);
    // every numbered step points at a detail doc unless it is a plain action
    const linked = items.filter((l) => /\]\(/.test(l));
    expect(linked.length).toBeGreaterThanOrEqual(8);
  });

  it('deploy table covers the four parts', () => {
    const rows = section(readme, 'Deploy').filter((l) => l.startsWith('|')).slice(2);
    expect(rows).toHaveLength(4);
    const text = rows.join('\n');
    for (const w of ['Supabase', 'api', 'admin', 'web', 'supabase db push']) expect(text, w).toContain(w);
  });

  it('does not copy sentences from WEB.md, ADMIN.md or DEPLOY-API.md', () => {
    const picks: [string, string][] = [
      ['WEB.md', 'Cutover checklist (web part)'],
      ['ADMIN.md', 'Deploying the admin (human steps)'],
      ['DEPLOY-API.md', '8. Deploy'],
    ];
    const flat = squash(readme);
    for (const [file, title] of picks) {
      const body = section(readFileSync(`${root}/docs/${file}`, 'utf8'), title);
      const prose = body.filter((l) => l.trim() !== '' && !/^([|#>`\-*]|\d+\.)/.test(l.trim()));
      const first = squash(prose.join(' '))
        .split(/(?<=[.!?])\s/)
        .find((s) => s.length >= 25);
      expect(first, `${file} ${title} has a prose sentence`).toBeDefined();
      expect(flat, `${file}: ${first}`).not.toContain(first!);
    }
  });
});
