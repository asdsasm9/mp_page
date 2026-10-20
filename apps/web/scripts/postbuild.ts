// Postbuild (plan WP3-20): writes dist/_redirects, dist/_headers and dist/_publish.json and verifies that
// every inline script in dist is covered by the CSP. Usage: runs after `astro build` (npm run build -w apps/web).
// Astro ignores underscore-prefixed page files, which is why these are written here and not as pages.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSnapshot } from '../src/lib/catalog';
import { assertProductionOutput, readRawEnv, resolveEnv } from '../src/lib/env';
import { buildHeaders, cspOfHeaders } from '../src/lib/headers';
import { SITE_ORIGIN } from '../src/lib/jsonld';
import { checkAnalyticsOutput, collectScriptHashes, missingScriptHashes, ogImagePathOf, PostbuildError } from '../src/lib/postbuild';
import { buildPublishJson } from '../src/lib/publish-json';
import { buildRedirects } from '../src/lib/redirects';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '..', 'dist');

function htmlFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.html'))
    .map((f) => join(dir, f));
}

async function main(): Promise<void> {
  const env = resolveEnv(readRawEnv());
  assertProductionOutput(env, dist);
  const snapshot = await loadSnapshot(env);

  const pages = htmlFiles(dist).map((file) => ({ path: relative(dist, file), html: readFileSync(file, 'utf8') }));
  const home = pages.find((p) => p.path === 'index.html');
  if (!home) throw new PostbuildError('dist/index.html is missing');

  // In fixture mode the image base is site-relative, so its origin is the site's own.
  const imgOrigin = new URL(env.imgBaseUrl, SITE_ORIGIN).origin;
  const redirects = buildRedirects({ imgOrigin, data: snapshot.redirects, ogImagePath: ogImagePathOf(home.html) });
  const headers = buildHeaders({ noindex: env.noindex, adminOrigin: env.adminOrigin, analytics: env.analyticsToken !== null, imgOrigin, scriptHashes: collectScriptHashes(pages) });
  const publish = buildPublishJson(snapshot, env, new Date());

  writeFileSync(join(dist, '_redirects'), redirects);
  writeFileSync(join(dist, '_headers'), headers);
  writeFileSync(join(dist, '_publish.json'), `${JSON.stringify(publish, null, 2)}\n`);

  // Verify what was written, not what was meant to be written.
  const csp = cspOfHeaders(readFileSync(join(dist, '_headers'), 'utf8'));
  if (csp === null) throw new PostbuildError('dist/_headers has no Content-Security-Policy');
  const missing = missingScriptHashes(pages, csp);
  if (missing.length > 0) {
    throw new PostbuildError(`inline scripts not covered by the CSP: ${missing.map((m) => `${m.path} ${m.hash}`).join(', ')}`);
  }
  const scripts = readdirSync(dist, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.js'))
    .map((f) => ({ path: f, text: readFileSync(join(dist, f), 'utf8') }));
  const analyticsErrors = checkAnalyticsOutput({
    pages,
    headersText: readFileSync(join(dist, '_headers'), 'utf8'),
    token: env.analyticsToken,
    scripts,
  });
  if (analyticsErrors.length > 0) throw new PostbuildError(`analytics output check failed: ${analyticsErrors.join('; ')}`);
  console.log(`postbuild: _redirects, _headers, _publish.json written (${env.siteEnv}, ${env.source}).`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
