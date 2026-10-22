import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { gitPaths, loadFiles } from './gates.mjs';
import { isEnvScope, scanEnvNames, scanEnvUsage, stripComments } from './lib/env-scan.mjs';

const f = (path, text = '') => ({ path, text });
const scan = (text, path = 'apps/api/src/x.ts') => scanEnvNames([f(path, text)]);

describe('env-scan patterns', () => {
  it('import.meta.env.X and process.env.X', () => {
    expect(scan('const a = import.meta.env.VITE_BACKEND; const b = process.env.PUBLIC_IMG_BASE_URL;')).toEqual([
      'PUBLIC_IMG_BASE_URL',
      'VITE_BACKEND',
    ]);
  });
  it('optional chaining and bracket access', () => {
    expect(scan("a = process.env?.A_ONE; b = process.env['B_TWO']; c = import.meta.env[\"C_THREE\"]; d = env['D_FOUR']")).toEqual([
      'A_ONE',
      'B_TWO',
      'C_THREE',
      'D_FOUR',
    ]);
  });
  it('env.X, raw.X, meta.X and proc.X receivers', () => {
    expect(scan('x = env.SUPABASE_URL + raw.PUBLIC_SITE_ENV + meta.M_ONE + proc.P_ONE')).toEqual([
      'M_ONE',
      'PUBLIC_SITE_ENV',
      'P_ONE',
      'SUPABASE_URL',
    ]);
  });
  it('destructuring with rename and default', () => {
    expect(scan('const { A_ONE, B_TWO: two, C_THREE = 1 } = process.env;')).toEqual(['A_ONE', 'B_TWO', 'C_THREE']);
    expect(scan('const { D_FOUR } = import.meta.env')).toEqual(['D_FOUR']);
    expect(scan('const { notEnv } = other')).toEqual([]);
  });
  it('read helpers req / text / get / pick', () => {
    expect(scan("req('R2_BUCKET', ok); text(env, 'SUPABASE_URL'); get('VITE_X_URL'); pick(\"PUBLIC_A_B\")")).toEqual([
      'PUBLIC_A_B',
      'R2_BUCKET',
      'SUPABASE_URL',
      'VITE_X_URL',
    ]);
  });
  it('quoted names in name-list files only', () => {
    const list = "export const CONNECT_ENV = ['VITE_SUPABASE_URL', 'VITE_R2_UPLOAD_ORIGIN'] as const;";
    expect(scan(list, 'apps/admin/headers.ts')).toEqual(['VITE_R2_UPLOAD_ORIGIN', 'VITE_SUPABASE_URL']);
    expect(scan(list, 'apps/admin/vite.config.ts')).toEqual(['VITE_R2_UPLOAD_ORIGIN', 'VITE_SUPABASE_URL']);
    expect(scan(list, 'apps/api/src/env.ts')).toEqual(['VITE_R2_UPLOAD_ORIGIN', 'VITE_SUPABASE_URL']);
    expect(scan(list, 'apps/admin/src/other.ts')).toEqual([]);
  });
  it('quoted constants that are not names in a name-list file are ignored', () => {
    expect(scan("const a = 'Some text'; const b = 'lower_case'; const c = 'X'", 'apps/api/src/env.ts')).toEqual([]);
    expect(scan("readonly code = 'BUILD_CONFIG' as const; f(['ONE_LIST', 'x'])", 'apps/web/src/lib/env.ts')).toEqual(['ONE_LIST']);
  });
  it('mixed-case and non-env receivers are not names', () => {
    expect(scan('x = config.SUPABASE_URL + obj.env.Foo + myenv.A_B + env.lowerCase')).toEqual([]);
  });
});

describe('env-scan comments and scope', () => {
  it('ignores line and block comments', () => {
    const text = [
      '// Usage: CHROME_PATH=/x node a.mjs, reads process.env.IN_LINE_COMMENT',
      '/* process.env.IN_BLOCK */',
      '/**',
      ' * Reads process.env.IN_JSDOC',
      ' */',
      'const real = process.env.REAL_ONE; // trailing env.TRAILING_ONE',
    ].join('\n');
    expect(scan(text)).toEqual(['REAL_ONE']);
  });
  it('keeps urls and globs in strings from opening a comment', () => {
    const text = "const u = 'https://x.test'; const g = 'src/**/*.ts'; const v = process.env.AFTER_URL;";
    expect(scan(text)).toEqual(['AFTER_URL']);
    expect(stripComments(text)).toBe(text);
  });
  it('excludes test files and test support', () => {
    const body = 'x = process.env.ONLY_IN_TEST';
    for (const p of [
      'apps/admin/src/a.test.tsx',
      'apps/api/src/a.spec.ts',
      'scripts/gates.test.mjs',
      'apps/api/test/quota.ts',
      'apps/api/src/test-support.ts',
      'apps/web/src/__tests__/a.ts',
      'scripts/__golden__/a.mjs',
    ]) {
      expect(scan(body, p), p).toEqual([]);
    }
  });
  it('scope: production code under apps, packages, scripts and root configs only', () => {
    const body = 'x = process.env.IN_SCOPE';
    for (const p of [
      'apps/web/src/lib/env.ts',
      'apps/web/src/pages/a.astro',
      'apps/admin/vite.config.ts',
      'apps/web/astro.config.mjs',
      'packages/shared/src/a.ts',
      'scripts/migrate-legacy/live-guard.ts',
      'scripts/lib/x.mjs',
      'vitest.config.ts',
    ]) {
      expect(scan(body, p), p).toEqual(['IN_SCOPE']);
    }
    for (const p of [
      'legacy/a.js',
      'docs/a.md',
      'supabase/tests/a.ts',
      'apps/web/dist/a.js',
      'node_modules/x/a.js',
      'apps/admin/src/style.css',
      'README.md',
      'apps/web/public/a.js',
    ]) {
      expect(scan(body, p), p).toEqual([]);
      expect(isEnvScope(p), p).toBe(false);
    }
  });
  it('result is sorted, unique, and usage lists the files', () => {
    const files = [f('scripts/b.mjs', 'process.env.ZED_ONE; process.env.ALPHA_ONE'), f('scripts/a.mjs', 'env.ZED_ONE')];
    expect(scanEnvNames(files)).toEqual(['ALPHA_ONE', 'ZED_ONE']);
    expect(scanEnvUsage(files).get('ZED_ONE')).toEqual(['scripts/a.mjs', 'scripts/b.mjs']);
  });
});

describe('env-scan property check', () => {
  const names = ['A_B', 'SUPABASE_URL', 'VITE_R2_UPLOAD_ORIGIN', 'PUBLIC_CF_ANALYTICS_TOKEN', 'X2_Y3_Z4', 'CI'];
  const forms = [
    (n) => `import.meta.env.${n}`,
    (n) => `process.env.${n}`,
    (n) => `process.env['${n}']`,
    (n) => `env.${n}`,
    (n) => `const { ${n} } = process.env;`,
    (n) => `const { ${n}: v } = env;`,
    (n) => `req('${n}')`,
    (n) => `text(env, '${n}')`,
  ];
  it.each(names)('every form finds %s, and the commented form does not', (n) => {
    for (const form of forms) {
      expect(scan(form(n))).toEqual([n]);
      expect(scan(`// ${form(n)}`)).toEqual([]);
      expect(scan(`/* ${form(n)} */`)).toEqual([]);
    }
  });
});

describe('env-scan on the real repo', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const names = scanEnvNames(loadFiles(root, gitPaths(root)));
  it.each([
    'SUPABASE_URL',
    'R2_SECRET_ACCESS_KEY',
    'PUBLIC_ADMIN_ORIGIN',
    'PUBLIC_CF_ANALYTICS_TOKEN',
    'VITE_R2_UPLOAD_ORIGIN',
    'MIGRATE_ACCESS_TOKEN',
    'CHROME_PATH',
  ])('finds %s', (n) => expect(names).toContain(n));
  it('finds the worker, admin, web and script groups, and nothing malformed', () => {
    for (const n of ['ALLOWED_ORIGINS', 'VITE_BACKEND', 'PUBLIC_SITE_ENV', 'PUBLIC_IMG_BASE_URL', 'MIGRATE_ACCESS_TOKEN', 'DESIGN_CHECK_NO_FALLBACK']) {
      expect(names).toContain(n);
    }
    expect(names).toContain('API_BASE_URL');
    expect(names).not.toContain('BUILD_CONFIG');
    expect(names.every((n) => /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/.test(n))).toBe(true);
  });
  it('does not pick up names that appear only in test files', () => {
    const usage = scanEnvUsage(loadFiles(root, gitPaths(root)));
    for (const paths of usage.values()) expect(paths.some((p) => /\.test\./.test(p))).toBe(false);
  });
});
