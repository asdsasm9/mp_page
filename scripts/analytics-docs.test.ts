/** docs/WEB.md must document analytics: variable, CSP hosts, tag form, switch-off and the human steps. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = `${import.meta.dirname}/..`;
const read = (p: string) => readFileSync(`${root}/${p}`, 'utf8');
const web = read('docs/WEB.md');
const section = web.split('\n## Analytics\n')[1]?.split('\n## ')[0] ?? '';

describe('docs/WEB.md Analytics section', () => {
  it('exists', () => {
    expect(section.length).toBeGreaterThan(500);
  });

  it.each(['PUBLIC_CF_ANALYTICS_TOKEN', 'https://static.cloudflareinsights.com', 'https://cloudflareinsights.com', 'type="module"', 'unset', 'redeploy', 'TO VERIFY'])(
    'names %s',
    (s) => {
      expect(section).toContain(s);
    },
  );

  it('keeps the Pages automatic setup toggle OFF on both projects', () => {
    expect(section).toMatch(/automatic setup[^]*OFF[^]*(both|`web` and `admin`)/);
  });

  it('lists the five human steps', () => {
    const steps = section.split('### Analytics: human steps')[1] ?? '';
    for (const n of [1, 2, 3, 4, 5]) expect(steps, `step ${n}`).toMatch(new RegExp(`^${n}\\. `, 'm'));
    expect(steps).toContain('VERIFY row 10');
    expect(steps).toContain('H-7');
  });

  it('is linked from the cutover checklist and the README', () => {
    expect(web).toContain('(#analytics)');
    expect(read('README.md')).toContain('docs/WEB.md#analytics');
  });

  it('has the status notes in the other docs', () => {
    expect(read('docs/ANALYTICS-CONSENT.md')).toContain('D-3: option C chosen; option A material is the upgrade path, not built');
    expect(read('docs/SEO.md')).toContain('Cloudflare Web Analytics, from launch');
    const row = read('docs/VERIFY.md').split('\n').find((l) => l.startsWith('| 10 | Cloudflare'));
    expect(row).toContain('automated parts done, human browser check pending');
  });
});
