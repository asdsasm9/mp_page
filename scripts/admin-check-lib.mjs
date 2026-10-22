// Pure judges of admin-check (WP5-28): no browser in here, so admin-check.test.mjs can feed them synthetic inputs and
// prove that a 30 px button, a request to another origin, an axe violation and so on make the check fail.

export const PHONE_MIN_TARGET = 44; // px, tap target on a phone (ADMIN-UX, WCAG 2.5.5 level of care)
export const DESKTOP_MIN_TARGET = 24; // px, WCAG 2.5.8 minimum on a pointer device
export const CLS_LIMIT = 0.1;
export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** Request URLs allowed besides the page's own origin: data: and blob: only. */
export function judgeOrigins(urls, pageOrigin) {
  const bad = [];
  for (const raw of urls) {
    let u;
    try {
      u = new URL(raw);
    } catch {
      bad.push(`request to an unparseable URL: ${String(raw).slice(0, 80)}`);
      continue;
    }
    if (u.protocol === 'data:' || u.protocol === 'blob:') continue;
    if (u.origin !== pageOrigin) bad.push(`request to another origin: ${u.origin}${u.pathname}`);
  }
  return bad;
}

/** Interactive elements as the page measured them: [{ name, w, h }]. A target must be at least `min` on both sides. */
export function judgeTargets(targets, phone) {
  const min = phone ? PHONE_MIN_TARGET : DESKTOP_MIN_TARGET;
  return targets
    .filter((t) => Math.min(t.w, t.h) < min - 0.01)
    .map((t) => `target ${t.name} is ${Math.round(t.w)}x${Math.round(t.h)} px, under ${min}`);
}

/** Serious and critical axe violations fail; the rest are listed by the caller as notes. */
export function judgeAxe(violations) {
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `axe ${v.impact} ${v.id} (${v.nodes} node${v.nodes === 1 ? '' : 's'}): ${v.target ?? ''}${v.summary ? ` - ${v.summary}` : ''}`);
}

export function judgeOverflow(scrollWidth, innerWidth) {
  return scrollWidth > innerWidth ? [`horizontal overflow ${scrollWidth - innerWidth} px (document ${scrollWidth} > viewport ${innerWidth})`] : [];
}

/** Console messages [{ type, text }]: errors and warnings fail, everything else is ignored. */
export function judgeConsole(messages) {
  return messages
    .filter((m) => m.type === 'error' || m.type === 'warning' || m.type === 'pageerror')
    .map((m) => `console ${m.type}: ${String(m.text).slice(0, 200)}`);
}

/** Cumulative layout shift of the worst session window (gap 1 s, cap 5 s) from layout-shift entries [{ value, startTime }]. */
export function clsOf(entries) {
  let worst = 0;
  let window = 0;
  let first = 0;
  let last = 0;
  for (const e of [...entries].sort((a, b) => a.startTime - b.startTime)) {
    if (window > 0 && e.startTime - last < 1000 && e.startTime - first < 5000) {
      window += e.value;
    } else {
      window = e.value;
      first = e.startTime;
    }
    last = e.startTime;
    worst = Math.max(worst, window);
  }
  return worst;
}

export function judgeCls(value) {
  return value > CLS_LIMIT ? [`layout shift ${value.toFixed(3)} over ${CLS_LIMIT}`] : [];
}

/** All judges for one checkpoint; `m` is what the page measured. Returns failure strings. */
export function judgeCheckpoint(m, { phone }) {
  return [...judgeAxe(m.axe), ...judgeOverflow(m.scrollWidth, m.innerWidth), ...judgeTargets(m.targets, phone)];
}

/**
 * Runs in the page (serialised by puppeteer, so it must stay self-contained): the interactive elements that are
 * rendered and enabled, with the box that a finger or pointer has to hit. A checkbox or radio is measured by its label
 * when it has one; a link inside running text is exempt (WCAG 2.5.8 inline exception).
 */
export function collectTargetsInPage() {
  const out = [];
  const selector = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=checkbox], [role=tab], [role=menuitem]';
  const describe = (el) => {
    const label = el.getAttribute('aria-label') || (el.textContent || '').trim().replace(/\s+/g, ' ') || el.getAttribute('name') || el.id || '';
    return `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : ''} "${label.slice(0, 40)}"`;
  };
  for (const el of document.querySelectorAll(selector)) {
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
    if (el.closest('[hidden], [inert]')) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') continue;
    if (el.classList.contains('skip-link')) continue; // only visible while focused
    if (el.classList.contains('visually-hidden')) continue;
    let box = el;
    if ((el.type === 'checkbox' || el.type === 'radio') && el.closest('label')) box = el.closest('label');
    const r = box.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    // a one-pixel clip box (visually hidden by other means)
    if (r.width <= 1 && r.height <= 1) continue;
    if (el.tagName === 'A' && getComputedStyle(el).display === 'inline') {
      const parent = el.parentElement;
      const own = (parent?.textContent || '').trim().length - (el.textContent || '').trim().length;
      if (parent && own > 8) continue; // link inside a sentence
    }
    out.push({ name: describe(el), w: r.width, h: r.height });
  }
  return out;
}
