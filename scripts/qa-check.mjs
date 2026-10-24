// qa-check (T-282): whole-site QA probes that design-check does not cover. Needs a built apps/web/dist.
// Usage: node scripts/qa-check.mjs <reflow|spacing|print|sizes> [--routes /,/svatby/] [--out .tmp/qa-check] [--dist apps/web/dist]
//   reflow  WCAG 1.4.10: 320x256 (400% zoom of 1280x1024) and 320x900; no horizontal scroll, lists the widest offenders.
//   spacing WCAG 1.4.12: line-height 1.5, letter-spacing .12em, word-spacing .16em, paragraph gap 2em; no clipped text, no overflow.
//   print   print media: PDF per route, page count, header/skip link hidden, nothing wider than the page, hero text readable.
//   sizes   viewport 1920 (DPR 1 and 2): each loaded image against the pixels it is drawn at (oversampling / softness), bytes.
// Exit 0 pass, 1 findings, 2 skipped (no Chrome).
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { findChrome } from './design-check.mjs';
import { ROUTES } from './design-check-lib.mjs';
import { createDistServer, listen } from './serve-dist.mjs';

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const routes = opt('routes', null)?.split(',') ?? ROUTES.map((r) => r.path);
const out = resolve(opt('out', '.tmp/qa-check'));
const dist = resolve(opt('dist', 'apps/web/dist'));

if (!['reflow', 'spacing', 'print', 'sizes'].includes(cmd)) {
  console.error('usage: node scripts/qa-check.mjs <reflow|spacing|print|sizes> [--routes a,b]');
  process.exit(1);
}
const chrome = findChrome();
if (!chrome || !existsSync(join(dist, 'index.html'))) {
  console.log('QA-CHECK SKIPPED: no Chrome or no build');
  process.exit(2);
}
mkdirSync(out, { recursive: true });
const { default: puppeteer } = await import('puppeteer-core');
const { server, origin } = await listen(createDistServer(dist));
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
const findings = [];
const name = (route) => route.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home';

async function open(route, viewport) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  // The site CSP (style-src 'self') would block the injected text-spacing stylesheet; only that probe needs the bypass.
  if (cmd === 'spacing') await page.setBypassCSP(true);
  await page.goto(origin + route, { waitUntil: 'networkidle0' });
  return page;
}

async function scrollThrough(page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += innerHeight / 2) {
      scrollTo({ top: y, behavior: 'instant' });
      await new Promise((r) => setTimeout(r, 40));
    }
    scrollTo({ top: 0, behavior: 'instant' });
    await Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; }))));
  });
}

const widest = (page) =>
  page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const bad = [];
    for (const el of document.body.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width && r.right > w + 1 && getComputedStyle(el).position !== 'fixed') bad.push(`${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}.${String(el.className).split(' ')[0]} right=${Math.round(r.right)}`);
    }
    return { overflow: document.documentElement.scrollWidth - w, bad: bad.slice(0, 5) };
  });

try {
  for (const route of routes) {
    if (cmd === 'reflow') {
      for (const vp of [{ width: 320, height: 256 }, { width: 320, height: 900 }]) {
        const page = await open(route, vp);
        const { overflow, bad } = await widest(page);
        const note = overflow > 0 ? ` OVERFLOW ${overflow}px: ${bad.join('; ')}` : '';
        console.log(`reflow ${route} ${vp.width}x${vp.height} overflow=${overflow}px${note}`);
        if (overflow > 0) findings.push(`reflow ${route} ${vp.width}x${vp.height} ${overflow}px`);
        if (vp.height === 256) await page.screenshot({ path: join(out, `reflow-${name(route)}-320x256.png`) });
        await page.close();
      }
    }

    if (cmd === 'spacing') {
      for (const width of [360, 1280]) {
        const page = await open(route, { width, height: 900 });
        await page.addStyleTag({
          content: '*{line-height:1.5 !important;letter-spacing:.12em !important;word-spacing:.16em !important}p{margin-block-end:2em !important}',
        });
        await new Promise((r) => setTimeout(r, 300));
        const res = await page.evaluate(() => {
          const clipped = [];
          for (const el of document.body.querySelectorAll('*')) {
            if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden' || el.classList.contains('visually-hidden')) continue;
            const hidesY = /hidden|clip/.test(cs.overflowY);
            const hidesX = /hidden|clip/.test(cs.overflowX);
            // a text element that clips its own overflow loses content under the larger spacing
            if ((hidesY && el.scrollHeight > el.clientHeight + 1) || (hidesX && el.scrollWidth > el.clientWidth + 1)) {
              clipped.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} scroll=${el.scrollWidth}x${el.scrollHeight} client=${el.clientWidth}x${el.clientHeight} "${el.textContent.trim().slice(0, 24)}"`);
            }
          }
          return { overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, clipped };
        });
        console.log(`spacing ${route} @${width} overflow=${res.overflow}px clipped=${res.clipped.length}${res.clipped.length ? ` ${res.clipped.slice(0, 4).join(' | ')}` : ''}`);
        if (res.overflow > 0 || res.clipped.length) findings.push(`spacing ${route} @${width}`);
        if (width === 360 && route === '/') await scrollThrough(page);
        if (route === '/' || route === '/svatby/') await page.screenshot({ path: join(out, `spacing-${name(route)}-${width}.png`), fullPage: true });
        await page.close();
      }
    }

    if (cmd === 'print') {
      const page = await open(route, { width: 1280, height: 900 });
      await scrollThrough(page);
      await page.emulateMediaType('print');
      const res = await page.evaluate(() => {
        const hidden = (sel) => [...document.querySelectorAll(sel)].every((e) => getComputedStyle(e).display === 'none');
        const heroText = document.querySelector('.hero h1');
        const w = document.documentElement.clientWidth;
        return {
          headerHidden: hidden('.site-header'),
          skipHidden: hidden('.skip-link'),
          bodyBg: getComputedStyle(document.body).backgroundColor,
          heroH1Color: heroText ? getComputedStyle(heroText).color : null,
          heroH1Visible: heroText ? heroText.getBoundingClientRect().height > 0 : null,
          overflow: document.documentElement.scrollWidth - w,
          carouselControls: [...document.querySelectorAll('.reference button, .carousel button')].filter((b) => b.getBoundingClientRect().height > 0).length,
        };
      });
      await page.setViewport({ width: 794, height: 1123 });
      await page.screenshot({ path: join(out, `print-${name(route)}.png`), fullPage: true });
      const pdf = join(out, `print-${name(route)}.pdf`);
      await page.pdf({ path: pdf, format: 'A4', printBackground: false, margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' } });
      console.log(`print ${route} ${JSON.stringify(res)} -> ${pdf}`);
      if (!res.headerHidden || !res.skipHidden) findings.push(`print ${route} chrome visible`);
      await page.close();
    }

    if (cmd === 'sizes') {
      for (const dpr of [1, 2]) {
        const page = await open(route, { width: 1920, height: 1080, deviceScaleFactor: dpr });
        await scrollThrough(page);
        await new Promise((r) => setTimeout(r, 300));
        const imgs = await page.evaluate(() =>
          [...document.images].filter((i) => i.currentSrc && i.complete && i.getBoundingClientRect().width > 0).map((i) => {
            const r = i.getBoundingClientRect();
            // naturalWidth is divided by the srcset density, so the loaded pixel width comes from the tier in the file name
            // (480/720/960/1600/2400.webp); site images (_astro/name_hash.webp) have no tier and use naturalWidth.
            const tier = /\/(\d+)\.(?:webp|jpg)$/.exec(i.currentSrc);
            const nw = tier ? Number(tier[1]) : i.naturalWidth;
            const aspect = i.naturalWidth / i.naturalHeight;
            const cover = getComputedStyle(i).objectFit === 'cover';
            const drawnWidth = cover ? Math.max(r.width, r.height * aspect) : r.width;
            return { src: i.currentSrc.replace(location.origin, ''), nw, box: `${Math.round(r.width)}x${Math.round(r.height)}`, ratio: nw / (drawnWidth * devicePixelRatio) };
          }),
        );
        const sizeOf = async (src) => {
          return page.evaluate(async (u) => (await (await fetch(u)).arrayBuffer()).byteLength, src);
        };
        let bytes = 0;
        for (const im of imgs) {
          im.bytes = await sizeOf(im.src);
          bytes += im.bytes;
          // ratio = loaded pixels per drawn device pixel: > 1.7 is more than one tier too big, < 0.85 is visibly soft
          const flag = im.ratio > 1.7 && im.nw > 480 ? 'TOO-BIG' : im.ratio < 0.85 ? 'SOFT' : '';
          console.log(`sizes ${route} dpr${dpr} ${flag.padEnd(7)} x${im.ratio.toFixed(2)} ${String(im.nw).padStart(4)}w box ${im.box.padEnd(9)} ${String(im.bytes).padStart(7)} B ${im.src.split('/').slice(-2).join('/')}`);
          if (flag === 'TOO-BIG') findings.push(`sizes ${route} dpr${dpr} ${im.src} x${im.ratio.toFixed(2)}`);
        }
        console.log(`sizes ${route} dpr${dpr} images=${imgs.length} bytes=${bytes}`);
        await page.close();
      }
    }
  }
} finally {
  await browser.close();
  server.close();
}
console.log(findings.length ? `QA-CHECK ${cmd.toUpperCase()}: ${findings.length} finding(s)\n- ${findings.join('\n- ')}` : `QA-CHECK ${cmd.toUpperCase()}: PASS`);
process.exit(findings.length ? 1 : 0);
