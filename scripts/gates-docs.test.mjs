import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CHECKS, checkDocsComplete, checkGatesRows, gitPaths, loadFiles } from './gates.mjs';
import { REQUIRED_DOCS, gatesDocRows, headingAnchors, markdownLinks, npmRunNames, slugify } from './gates-docs.mjs';

const f = (path, text = '') => ({ path, text });
const names = ['alpha-check', 'beta-check', 'docs-complete'];
// Fake secrets are assembled at runtime so this file never contains a secret-shaped literal.
const fakeJwt = ['eyJ', 'hbGciOiJIUzI1NiJ9', '.', 'eyJzdWIiOiJ4eHh4eHgifQ', '.', 'c2lnbmF0dXJl'].join('');

const README = [
  '# Project',
  '## Run',
  'Use `npm run gates` and see [the how-to](docs/NAVOD.md#když-něco-nejde) and [web](docs/WEB.md).',
  '## Test',
  '## Deploy',
  '## Cutover',
  'H-5 is DNS.',
  '## Maintenance',
  '',
].join('\n');
const GATES = ['# Gates', '| Name | What |', '|---|---|', ...names.map((n) => `| \`${n}\` | text |`), ''].join('\n');

function repo(over = {}) {
  const base = {
    'README.md': README,
    '.env.example': '# x\nA=\n',
    'docs/NAVOD.md': '# Návod\n## Když něco nejde\nText.\n',
    'docs/MAINTENANCE.md': '# Maintenance\n',
    'docs/BACKUP.md': '# Backup\n',
    'docs/GATES.md': GATES,
    'docs/WEB.md': '# Web\n',
    'docs/ADMIN.md': '# Admin\n',
    'docs/DEPLOY-API.md': '# Deploy\n',
    'docs/MIGRATION.md': '# Migration\n',
    'docs/DATA-MODEL.md': '# Data\n',
    'docs/API.md': '# API\n',
    'package.json': JSON.stringify({ scripts: { gates: 'node scripts/gates.mjs', build: 'x' } }),
  };
  return Object.entries({ ...base, ...over })
    .filter(([, t]) => t !== null)
    .map(([p, t]) => f(p, t));
}
const run = (over) => checkDocsComplete(repo(over), names);

describe('docs-complete', () => {
  it('passes a complete synthetic repo', () => {
    const r = run();
    expect(r.status, r.details).toBe('PASS');
  });

  it.each(REQUIRED_DOCS)('fails when %s is missing', (p) => {
    const r = run({ [p]: null });
    expect(r.status).toBe('FAIL');
    expect(r.details).toContain(`${p} missing`);
  });

  it('fails on a dead link and names file and line', () => {
    const r = run({ 'docs/WEB.md': '# Web\n\nSee [x](NOPE.md).\n' });
    expect(r.status).toBe('FAIL');
    expect(r.details).toContain('docs/WEB.md:3 dead link NOPE.md');
  });

  it('fails on a dead anchor', () => {
    const r = run({ 'docs/WEB.md': '# Web\n[x](NAVOD.md#neexistuje)\n' });
    expect(r.status).toBe('FAIL');
    expect(r.details).toContain('dead anchor NAVOD.md#neexistuje');
  });

  it('fails on a dead anchor inside the same file, passes a live one', () => {
    expect(run({ 'docs/WEB.md': '# Web\n## Build modes\n[x](#build-modes)\n' }).status).toBe('PASS');
    expect(run({ 'docs/WEB.md': '# Web\n[x](#build-modes)\n' }).status).toBe('FAIL');
  });

  it('ignores links inside code, external links and mailto', () => {
    const text = '# Web\n`[x](gone.md)`\n```\n[y](gone2.md)\n```\n[a](https://example.com/x) [b](mailto:a@b.cz)\n';
    expect(run({ 'docs/WEB.md': text }).status).toBe('PASS');
  });

  it('accepts links to directories and to binaries it does not load', () => {
    const text = '# Web\n[d](../scripts) [i](shot.png)\n';
    expect(run({ 'docs/WEB.md': text, 'scripts/a.mjs': 'x' }).status).toBe('PASS');
  });

  it.each(['TODO', 'FIXME', '[doplnit]', 'lorem ipsum', 'XXX'])('fails on %s in a new doc', (word) => {
    for (const p of ['README.md', 'docs/NAVOD.md', 'docs/MAINTENANCE.md', 'docs/BACKUP.md', 'docs/GATES.md']) {
      const base = repo().find((x) => x.path === p).text;
      const r = run({ [p]: `${base}\n${word}\n` });
      expect(r.status, p).toBe('FAIL');
      expect(r.details, p).toContain('placeholder');
    }
  });

  it('allows the same words in an older doc', () => {
    expect(run({ 'docs/WEB.md': '# Web\nTODO later, [doplnit]\n' }).status).toBe('PASS');
  });

  it('fails on an unknown npm script but skips workspace forms', () => {
    const bad = run({ 'docs/WEB.md': '# Web\nRun `npm run nope`.\n' });
    expect(bad.status).toBe('FAIL');
    expect(bad.details).toContain('unknown npm script "nope"');
    expect(run({ 'docs/WEB.md': '# Web\nRun `npm run dev -w apps/web` and `npm run -w apps/web x`.\n' }).status).toBe('PASS');
    expect(run({ 'docs/WEB.md': '# Web\n```\nnpm run build\n```\n' }).status).toBe('PASS');
  });

  it('fails when a check name has no row in GATES.md and when a row is not a check', () => {
    const missing = run({ 'docs/GATES.md': GATES.replace('| `beta-check` | text |\n', '') });
    expect(missing.status).toBe('FAIL');
    expect(missing.details).toContain('no row for beta-check');
    const extra = run({ 'docs/GATES.md': `${GATES}| \`ghost\` | text |\n` });
    expect(extra.status).toBe('FAIL');
    expect(extra.details).toContain('row ghost is not a check');
  });

  it.each(['Run', 'Test', 'Deploy', 'Cutover', 'Maintenance'])('fails when README has no %s heading', (h) => {
    const r = run({ 'README.md': README.replace(`## ${h}\n`, '') });
    expect(r.status).toBe('FAIL');
    expect(r.details).toContain(`no "${h}" heading`);
  });

  it('fails when README does not mention H-5', () => {
    const r = run({ 'README.md': README.replace('H-5', 'H5') });
    expect(r.details).toContain('H-5');
  });

  it('fails on a secret-shaped string in a new doc, not in an old one', () => {
    const r = run({ 'docs/BACKUP.md': `# Backup\n${fakeJwt}\n` });
    expect(r.status).toBe('FAIL');
    expect(r.details).toContain('JWT');
    expect(run({ 'docs/WEB.md': `# Web\n${fakeJwt}\n` }).status).toBe('PASS');
  });
});

describe('markdown helpers', () => {
  it('slugifies like GitHub and keeps Czech diacritics', () => {
    expect(slugify('Když něco nejde')).toBe('když-něco-nejde');
    expect(slugify('Úložiště a varování')).toBe('úložiště-a-varování');
    expect(slugify('ŘEŠENÍ: Čeština, žluťoučký kůň!')).toBe('řešení-čeština-žluťoučký-kůň');
    expect(slugify('Deploy `api` (Worker) & more')).toBe('deploy-api-worker--more');
    expect(slugify('3. Pre-launch [list](x.md)')).toBe('3-pre-launch-list');
  });

  it('a Czech anchor resolves, plain and percent-encoded; an ASCII-folded one does not', () => {
    const navod = '# Návod\n## Když něco nejde\n';
    const link = (a) => run({ 'docs/NAVOD.md': navod, 'docs/WEB.md': `# Web\n[x](NAVOD.md#${a})\n` });
    expect(link('když-něco-nejde').status).toBe('PASS');
    expect(link(encodeURIComponent('když-něco-nejde')).status).toBe('PASS');
    expect(link('kdyz-neco-nejde').status).toBe('FAIL');
  });

  it('numbers repeated headings and ignores headings in code fences', () => {
    const a = headingAnchors('# A\n## Same\n## Same\n```\n# not a heading\n```\n');
    expect([...a]).toEqual(['a', 'same', 'same-1']);
  });

  it('extracts relative links only, with line numbers', () => {
    expect(markdownLinks('a\n[x](a.md#b) [y](https://e.com) ![i](i.png "t")\n')).toEqual([
      { target: 'a.md#b', line: 2 },
      { target: 'i.png', line: 2 },
    ]);
  });

  it('npmRunNames skips workspace forms', () => {
    expect(npmRunNames('npm run a, npm run b:c -w x, npm run -w y z, npm run d --workspace x')).toEqual(['a']);
  });
});

describe('GATES.md rows', () => {
  it('gatesDocRows reads the backticked first cell only', () => {
    expect(gatesDocRows('| `a-b` | `c` |\n| x | `d` |\n')).toEqual(['a-b']);
  });
  it('flags a duplicate row', () => {
    const r = checkGatesRows([f('docs/GATES.md', `${GATES}| \`alpha-check\` | again |\n`)], names);
    expect(r.status).toBe('FAIL');
    expect(r.details).toContain('twice');
  });
});

describe('real repo', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const files = loadFiles(root, gitPaths(root));
  const checkNames = CHECKS.map((c) => c.name);

  it('docs-complete is green', () => {
    const r = checkDocsComplete(files, checkNames);
    expect(r.status, r.details).toBe('PASS');
  });

  it('docs/GATES.md has exactly one row per CHECKS entry', () => {
    const rows = gatesDocRows(files.find((x) => x.path === 'docs/GATES.md').text);
    expect([...rows].sort()).toEqual([...checkNames].sort());
    expect(new Set(rows).size).toBe(rows.length);
  });

  it('docs-complete is no longer pending in the registry', () => {
    const entry = CHECKS.find((c) => c.name === 'docs-complete');
    expect(entry.run(files).status).toBe('PASS');
  });
});
