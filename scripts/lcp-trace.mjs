// Diagnostic (T-282): Lighthouse mobile LCP/FCP/CLS for several routes of any dist folder, to compare variants.
// Usage: node scripts/lcp-trace.mjs <dist-dir> /,/svatby/
import { resolve } from 'node:path';
import { findChrome } from './design-check.mjs';
import { createDistServer, listen } from './serve-dist.mjs';

const dist = resolve(process.argv[2] ?? 'apps/web/dist');
const routes = (process.argv[3] ?? '/').split(',');
const [{ default: puppeteer }, { default: lighthouse }] = await Promise.all([import('puppeteer-core'), import('lighthouse')]);
const { server, origin } = await listen(createDistServer(dist));
try {
  for (const route of routes) {
    const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true, args: ['--no-sandbox', '--remote-debugging-port=9225'] });
    try {
      const { lhr } = await lighthouse(origin + route, { port: 9225, output: 'json', logLevel: 'error', onlyCategories: ['performance'] });
      const a = lhr.audits;
      const reqs = a['network-requests'].details.items;
      const bytes = reqs.reduce((s, r) => s + (r.transferSize ?? 0), 0);
      console.log(`${route} LCP=${Math.round(a['largest-contentful-paint'].numericValue)} FCP=${Math.round(a['first-contentful-paint'].numericValue)} CLS=${a['cumulative-layout-shift'].numericValue.toFixed(3)} TBT=${Math.round(a['total-blocking-time'].numericValue)} requests=${reqs.length} bytes=${bytes}`);
    } finally {
      await browser.close();
    }
  }
} finally {
  server.close();
}
