// Synthetic Worker files for the arch-api-surface gate tests (shared by gates.test.mjs and api-surface.test.mjs).
export const apiGolden = {
  routes: ['/health', '/storage', '/uploads/reserve', '/publish'],
  bindings: ['PHOTOS', 'BACKUP'],
  cronCount: 1,
  secrets: ['R2_SECRET_ACCESS_KEY'],
  plainVars: ['SUPABASE_URL'],
};

export const apiDefaults = {
  'apps/api/src/default-routes.ts': `export const DEFAULT_ROUTES: Readonly<Record<string, (s: Storages) => Route>> = {
  '/storage': () => storageRoute,
  '/uploads/reserve': (s) => createReserveRoute({ storage: s.photos }),
  '/publish': (s) => createPublishRoute({ publicBucket: s.photos }),
};
`,
  'apps/api/src/index.ts': `if (pathname === '/health') route = healthRoute;\nelse if (x) route = y;\n`,
  'apps/api/src/env.ts': `const a = req('SUPABASE_URL', (v) => urlOk(v));\nconst b = req('R2_SECRET_ACCESS_KEY');\n`,
  'apps/api/wrangler.toml': `name = "x"
[triggers]
crons = ["17 3 * * *"]
[[r2_buckets]]
binding = "PHOTOS"
bucket_name = "a"
[[r2_buckets]]
binding = "BACKUP"
bucket_name = "b"
`,
  'docs/API.md': '# API\n## GET /health\n## GET /storage\n## POST /uploads/reserve\n## POST /publish\n',
};

/** Files for checkArchApiSurface; `over` replaces a file's text or removes it (null). */
export const apiFiles = (over = {}) =>
  Object.entries({ ...apiDefaults, ...over })
    .filter(([, t]) => t !== null)
    .map(([path, text]) => ({ path, text }));
