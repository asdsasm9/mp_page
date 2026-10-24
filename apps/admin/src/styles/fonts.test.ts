import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

/** The @font-face blocks, comments removed and whitespace normalised. */
function faces(css: string): string[] {
  return [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/@font-face\s*\{[^}]*\}/g)].map((m) => m[0].replace(/\s+/g, ' ').trim());
}

describe('admin fonts.css', () => {
  const web = faces(read('../../../web/src/styles/fonts.css'));
  const admin = faces(read('./fonts.css'));

  it('declares the same six @font-face blocks as the public site (four fonts, two fallbacks)', () => {
    expect(web).toHaveLength(6);
    expect(admin).toEqual(web);
  });

  it('uses the same package paths (the path prefix is the bare @fontsource specifier in both apps)', () => {
    const urls = admin.flatMap((b) => [...b.matchAll(/url\('(@fontsource\/[^']+)'\)/g)].map((m) => m[1]));
    expect(urls.sort()).toEqual([
      '@fontsource/cormorant-garamond/files/cormorant-garamond-latin-400-normal.woff2',
      '@fontsource/cormorant-garamond/files/cormorant-garamond-latin-ext-400-normal.woff2',
      '@fontsource/lora/files/lora-latin-400-normal.woff2',
      '@fontsource/lora/files/lora-latin-ext-400-normal.woff2',
    ]);
  });

  it('has no remote font URL', () => {
    expect(read('./fonts.css')).not.toMatch(/https?:\/\//);
  });

  // Chrome checks the CSP of every @font-face url() when the rule is parsed, even for a face no text uses, so
  // importing fonts.css without `font-src 'self'` in headers.ts puts CSP errors in every admin page's console.
  it('is imported by the entry before tokens.css, and the admin CSP allows font-src self', () => {
    const main = read('../main.tsx');
    const headers = read('../../headers.ts');
    expect(main).toMatch(/import '\.\/styles\/fonts\.css';/);
    expect(main.indexOf('styles/fonts.css')).toBeLessThan(main.indexOf('styles/tokens.css'));
    expect(headers).toMatch(/"font-src 'self'"/);
  });

  it('Vite never inlines a woff2 as a data: URL (the CSP has no data: in font-src)', () => {
    const config = read('../../vite.config.ts');
    expect(config).toMatch(/assetsInlineLimit[^\n]*\.woff2[^\n]*false/);
  });
});
