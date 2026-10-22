// Diagnostic: Lighthouse LCP element, phases and the heaviest requests for one route.
// Usage: node scripts/lcp-probe.mjs /svatby/
import { resolve } from 'node:path';
import { findChrome } from './design-check.mjs';
import { createDistServer, listen } from './serve-dist.mjs';

const route = process.argv[2] ?? '/';
const [{ default: puppeteer }, { default: lighthouse }] = await Promise.all([import('puppeteer-core'), import('lighthouse')]);
const { server, origin } = await listen(createDistServer(resolve('apps/web/dist')));
const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true, args: ['--no-sandbox', '--remote-debugging-port=9224'] });
try {
  const { lhr } = await lighthouse(origin + route, { port: 9224, output: 'json', logLevel: 'error' });
  const a = lhr.audits;
  console.log('LCP', Math.round(a['largest-contentful-paint'].numericValue), 'perf', lhr.categories.performance.score);
  console.log(JSON.stringify(a['largest-contentful-paint-element']?.details ?? a['lcp-breakdown-insight']?.details ?? null).slice(0, 1500));
  console.log(JSON.stringify(a['network-requests']?.details?.items?.slice(0, 12).map((r) => [r.url.replace(origin, ''), Math.round(r.networkRequestTime), Math.round(r.networkEndTime), r.protocol])));
  const el =a['largest-contentful-paint-element']?.details?.items?.[0]?.items?.[0];
  console.log('LCP element', el?.node?.snippet);
  const phases = a['largest-contentful-paint-element']?.details?.items?.[1]?.items ?? [];
  for (const p of phases) console.log('phase', p.phase, Math.round(p.timing));
  for (const r of (a['network-requests']?.details?.items ?? []).sort((x, y) => y.transferSize - x.transferSize).slice(0, 8)) {
    console.log(r.url.replace(origin, ''), r.transferSize, r.mimeType);
  }
  for (const id of ['render-blocking-resources', 'uses-responsive-images', 'prioritize-lcp-image', 'lcp-lazy-loaded', 'is-crawlable']) {
    console.log(id, a[id]?.score, a[id]?.displayValue ?? '');
  }
} finally {
  await browser.close();
  server.close();
}
