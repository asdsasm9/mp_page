// design-check: Lighthouse (mobile, median of N), axe-core, 320 px reflow, console/CSP errors, screenshots.
// Usage: CHROME_PATH=/path/to/chrome npm run design-check [-- --routes /,/kontakt/ --runs 1 --out dir --dist dir]
// Needs a built apps/web/dist (npm run build -w apps/web). Exit 0 pass, 1 fail, 2 skipped (no Chrome).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  EXIT, REFLOW_WIDTH, SKIPPED_MESSAGE, isExpectedConsoleError, WIDTHS, aggregate, medianSummary, parseArgs, selectRoutes, summarizeLhr, verdictLine,
} from './design-check-lib.mjs';
import { createDistServer, listen } from './serve-dist.mjs';

const HELP = 'node scripts/design-check.mjs [--routes /a/,/b/] [--runs 3] [--out .tmp/design-check] [--dist apps/web/dist]';
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'];
const DEBUG_PORT = 9223;

export const CHROME_FALLBACKS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

// CHROME_PATH wins; otherwise the first well-known install path that exists.
export function findChrome(env = process.env, exists = existsSync) {
  const p = env.CHROME_PATH;
  if (p && exists(p)) return p;
  if (env.DESIGN_CHECK_NO_FALLBACK) return null; // tests only: simulate a machine without Chrome
  return CHROME_FALLBACKS.find((c) => exists(c)) ?? null;
}

// Full-page screenshots show grey boxes for lazy images that never entered the viewport; scroll through first.
async function loadLazyImages(page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += innerHeight / 2) {
      scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    scrollTo(0, 0);
    await Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; }))));
  });
}

// Scripted keyboard pass: Tab through the page, record each stop's focus indicator and whether something covers it.
async function keyboardPass(page, width, max = 60) {
  const stops = [];
  const seen = new Set();
  await page.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0); });
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    await new Promise((r) => setTimeout(r, 250)); // let focus transitions (e.g. the skip link slide-in) finish
    const stop = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body || el === document.documentElement) return null;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1), Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1));
      const label = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''} "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30)}"`;
      return {
        label, key: label + el.getAttribute('href'), outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth, boxShadow: cs.boxShadow,
        obscured: !(top === el || el.contains(top) || top?.contains(el)),
      };
    });
    if (!stop || seen.has(stop.key)) break;
    seen.add(stop.key);
    const { key, ...rest } = stop;
    stops.push({ ...rest, label: `${rest.label} @${width}` });
  }
  return stops;
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`${e.message}\n${HELP}`);
    return EXIT.FAIL;
  }
  if (opts.help) {
    console.log(HELP);
    return EXIT.PASS;
  }
  const chrome = findChrome();
  if (!chrome) {
    console.log(SKIPPED_MESSAGE);
    console.log(verdictLine('SKIPPED'));
    return EXIT.SKIPPED;
  }
  const dist = resolve(opts.dist);
  if (!existsSync(join(dist, 'index.html'))) {
    console.error(`${dist} has no index.html; run: npm run build -w apps/web`);
    return EXIT.FAIL;
  }
  const out = resolve(opts.out);
  mkdirSync(out, { recursive: true });

  const [{ default: puppeteer }, { default: lighthouse }] = await Promise.all([import('puppeteer-core'), import('lighthouse')]);
  const axeSource = readFileSync(resolve('node_modules/axe-core/axe.min.js'), 'utf8');
  const { server, origin } = await listen(createDistServer(dist));
  const routes = selectRoutes(opts.routes);
  const results = [];
  const report = { date: new Date().toISOString(), origin, routes: [] };
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
    for (const route of routes) {
      const url = origin + route.path;
      const entry = { route: route.path, name: route.name, light: Boolean(route.light), axe: [], overflow: 0, consoleErrors: [] };
      for (const width of [...WIDTHS, REFLOW_WIDTH]) {
        const page = await browser.newPage();
        page.on('console', (m) => {
          if (m.type() !== 'error' || width !== WIDTHS[2]) return;
          const msg = { text: m.text(), url: m.location()?.url };
          if (!isExpectedConsoleError(route, msg, url)) entry.consoleErrors.push(msg.text);
        });
        page.on('pageerror', (e) => { if (width === WIDTHS[2]) entry.consoleErrors.push(String(e.message ?? e)); });
        await page.setViewport({ width, height: 900 });
        await page.goto(url, { waitUntil: 'networkidle0' });
        if (width === REFLOW_WIDTH) {
          entry.overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        } else {
          await loadLazyImages(page);
          await page.screenshot({ path: join(out, `${route.name}-${width}.png`), fullPage: true });
        }
        if (width === WIDTHS[2]) {
          await page.evaluate(axeSource);
          const axe = await page.evaluate(async (tags) => {
            const r = await globalThis.axe.run(document, { runOnly: { type: 'tag', values: tags } });
            return r.violations.map((v) => ({ id: v.id, impact: v.impact, helpUrl: v.helpUrl, nodes: v.nodes.map((n) => n.target.join(' ')) }));
          }, AXE_TAGS);
          entry.axe = axe;
        }
        if (width !== REFLOW_WIDTH && width !== WIDTHS[1]) {
          // Dark scheme: the site is light-only (color-scheme: light), so this must look identical, not broken.
          await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
          await loadLazyImages(page);
          await page.screenshot({ path: join(out, `${route.name}-${width}-dark.png`), fullPage: true });
          await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
          entry.keyboard = [...(entry.keyboard ?? []), ...(await keyboardPass(page, width))];
        }
        await page.close();
      }
      if (!route.light) {
        const summaries = [];
        for (let i = 0; i < opts.runs; i++) {
          const lhBrowser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', `--remote-debugging-port=${DEBUG_PORT}`] });
          try {
            const res = await lighthouse(url, { port: DEBUG_PORT, output: 'json', logLevel: 'error' });
            summaries.push(summarizeLhr(res.lhr));
          } finally {
            await lhBrowser.close();
          }
        }
        entry.lighthouse = medianSummary(summaries);
      }
      results.push(entry);
      report.routes.push(entry);
      const lh = entry.lighthouse;
      console.log(
        `${route.path} axe=${entry.axe.length} tabstops=${entry.keyboard?.length ?? 0} overflow320=${entry.overflow}px console=${entry.consoleErrors.length}` +
          (lh ? ` perf=${lh.performance} a11y=${lh.accessibility} bp=${lh['best-practices']} seo=${lh.seo} LCP=${Math.round(lh.lcp)}ms CLS=${lh.cls?.toFixed(3)} TBT=${Math.round(lh.tbt)}ms` : ''),
      );
      for (const v of entry.axe) console.log(`  axe ${v.impact} ${v.id} (${v.nodes.length}) ${v.helpUrl}`);
    }
  } catch (e) {
    console.error(`design-check error: ${e.message}`);
    return EXIT.FAIL;
  } finally {
    await browser?.close();
    server.close();
  }
  const agg = aggregate(results);
  report.failures = agg.failures;
  report.verdict = agg.verdict;
  writeFileSync(join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  if (agg.failures.length) console.log(`\n${agg.failures.map((f) => `- ${f}`).join('\n')}`);
  console.log(verdictLine(agg.verdict));
  return agg.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
