# Lightbox: maintained library or the custom one? (T-225 part 4)

Question from Adam (2026-10-22): should the hand-built album lightbox
(`apps/web/src/scripts/lightbox*.ts`, markup and CSS in `apps/web/src/pages/[category]/[album]/index.astro`)
be replaced by PhotoSwipe or GLightbox?

**Recommendation: keep the custom lightbox.** The reported problem was a CSS bug, not a design flaw of
hand-building, and it is fixed (see the end). A swap would cost more than it returns for this site. Revisit only
if the table below changes (for example a feature the custom one cannot offer, or a maintenance burden).

Library sizes are approximate figures from the libraries' own documentation and public bundle analyses, not
measured here; this task added no dependency. Verify with `npm pack` plus a gzip of the built file before any swap.

| Point | Custom (today) | PhotoSwipe 5 | GLightbox |
| --- | --- | --- | --- |
| JS size, gzip | about 4 KB, loaded only on album pages | about 14 to 16 KB (core plus lightbox), plus about 3 KB CSS | about 11 to 13 KB plus about 4 KB CSS |
| Accessibility | Native `<dialog>` and `showModal`: focus trap, inert background, Escape, focus returns to the thumbnail. Named buttons, `aria-disabled` ends, polite zoom announcement, button alternative to pinch and drag (WCAG 2.5.7). axe 0 serious or critical (`npm run lightbox-a11y`) | Good keyboard support and ARIA, but its own focus handling (not `<dialog>`); button labels are options we would have to translate to Czech and verify | Basic keyboard support, weaker focus management and screen reader story; needs verification |
| Touch pinch and zoom | Own pointer gestures (double tap, pinch, pan, clamp), tested with CDP touch events | Best in class: pinch, pan, double tap, inertia | Pinch and drag exist, less polished |
| No-JS fallback | Each thumbnail is an `<a href>` to the 1600 JPEG; the script only upgrades it | Same pattern is supported (links to the large file) | Same pattern is supported |
| CSP without inline scripts | Bundled module script, no inline code, no `eval` | Works with a bundled import; options are passed from our own module | Bundled import works; it injects inline styles at runtime, which would need `style-src` review |
| Staged loading 720 to master (WP-3b) | Built in: the grid thumbnail shows instantly, the fit tier swaps in, the master loads once on first zoom, nothing is requested before opening (`npm run lightbox-network`) | Supports a placeholder and a single src or srcset per slide; our "fit then master on zoom, once, never under Save-Data" logic would have to be rewritten on top of its API and events | Single src per slide; the staged logic would be rebuilt outside it |
| LCP budget | No effect (not loaded on `/`, loaded lazily on album pages) | Same if code-split, but about 3 to 4 times the bytes on album pages | Same, plus CSS |
| Maintenance | We own about 600 lines with unit tests | Active upstream, but breaking changes between majors; we still own the glue | Less active upstream; pins an old API |
| Design tokens | Fully token-based, dark overlay from `--color-overlay` | Themable by CSS, but its defaults (colors, icons, sizes) would be overridden by hand | Same |

## Why not swap now

1. The dependency would add 3 to 4 times the JavaScript for a feature that already passes the accessibility and
   network checks.
2. The distinctive requirements (staged 720 to master with a single master request, nothing loaded before
   opening, `<dialog>` semantics, Czech announcements) are exactly the parts a library would not give us for free.
3. The defect Adam saw was layout CSS in our own markup; a library would have replaced the buttons but not
   removed the need to test centering.

## When to reconsider

- the photographer asks for features we do not have (swipe-to-dismiss with animation, thumbnails strip, video),
- the touch gesture code starts needing frequent fixes on real devices,
- a maintained library ships native `<dialog>` support and a staged-loading hook.

## What was fixed (custom lightbox)

Cause: `.lightbox[open]` was `display: grid; place-items: center`. The absolutely positioned counter and zoom group
were then placed against a grid area instead of the dialog box, so the counter drifted to a point left of centre on
wide screens and the controls looked misaligned against the centred photo.

Fix (CSS only, tokens only, `index.astro` of the album page):

- `.lightbox[open]` is `display: block; overflow: hidden`; the stage is exactly the viewport (`100%` by `100dvh`),
  so the photo is centred by `object-fit: contain`.
- Top row mirrors itself: counter at the start, close button (X) at the end, on the same centre line.
- Zoom group (minus, 1x, plus) is centred at the bottom (`inset-inline-start: 50%` and `translate: -50% 0`).
- Previous and next stay mirrored at the vertical middle.

Locked by `npm run lightbox-layout` (`scripts/lightbox-layout.mjs`): at 360x640, 768x1024 and 1280x800, for a
landscape and a portrait photo, fit and zoomed, it asserts the stage and photo centre equal the viewport centre,
the X and plus glyphs are centred in their buttons (within 1.5 px), counter and close mirror each other, the zoom
group centre equals the viewport centre, and prev and next mirror; screenshots go to `design-check-out/`.

## Look: keep or rebuild, second round (T-292)

Why it came up again: after T-291 the buttons still looked hand-made (text glyphs not centred in the round
buttons, counter and toolbar on slightly different lines, no hover or pressed state). That is a styling defect of
our markup, not a sign that the approach is wrong, and it is fixed without a dependency (see below).

Comparison for the decision (figures are approximate, from the libraries' documentation, not measured here; verify
with `npm pack` and gzip before any swap):

| Point | Keep custom (recommended) | Rebuild on PhotoSwipe 5 (or similar) |
| --- | --- | --- |
| Cost now | Done in this task, about 1 hour, no dependency | 2 to 4 days: wrapper, Czech labels, theming, re-test on real phones |
| Bundle | about 4 KB gzip, album pages only | about 14 to 16 KB JS plus about 3 KB CSS, album pages only (3 to 4 times more) |
| Accessibility | Native `<dialog>` (focus trap, inert page, Escape, focus return), named buttons, zoom buttons as the alternative to gestures (WCAG 2.5.7), axe 0 serious/critical | Good keyboard and ARIA, own focus handling (not `<dialog>`); labels and live regions must be re-verified in Czech |
| Touch and zoom | Own gestures: double tap, pinch, pan, clamp, page-zoom safety net (T-291), tested through CDP touch events | Best in class (inertia, swipe to close); its gesture model would replace our T-291 protections and need re-testing on iOS |
| Maintenance | About 600 lines we own, unit tests plus three scripted checks | Upstream maintained, but majors break the API and we still own the glue; a supply-chain dependency |
| CSP | Bundled module, no inline code, no `eval` | Works from a bundled import; verify no inline styles are injected (`style-src`) |
| Look | Fully tokens; one recipe for all buttons now | Themable, but its default icons, sizes and colours must be overridden to match the tokens |

Behaviour of ours a library would not give for free and that would have to be rebuilt on its API:

1. Staged loading: grid thumbnail shown instantly, fit tier swapped in, master requested once on first zoom, never
   under Save-Data, nothing requested before opening (`npm run lightbox-network`).
2. Native `<dialog>` semantics, with `inert` page and focus return to the opening thumbnail.
3. Czech announcements (`Přiblížení 150 %`), the `aria-disabled` ends of the prev, next and zoom buttons.
4. No-JS fallback: thumbnails are links to the 1600 JPEG and the script only upgrades them.
5. T-291 protections: `touch-action: none` on the whole dialog, `gesturestart` cancelled, `pageZoomFrame` re-fit,
   snap to fit, controls clear of safe-area insets.
6. Button alternative to pinch, double tap, wheel and drag (zoom group), keyboard zoom and pan (`+`, `-`, `0`, arrows).

Recommendation: **keep the custom lightbox**. A rebuild would trade about 4 KB for about 18 KB and still require
re-implementing items 1 to 5. Reconsider only if the owner wants features we lack (swipe-to-dismiss animation,
thumbnail strip, video) or the touch code keeps needing fixes on real devices. A rebuild is a new dependency and
therefore a human decision (D-23); no other task depends on it.

What changed for the look (T-292, `apps/web/src/pages/[category]/[album]/index.astro`, `Icon.astro`):

- Close, previous, next, plus and minus are the shared `Icon` SVG (new names `close`, `plus`, `minus`; chevrons
  reused), all drawn at one size (1.5 rem) with the same 1.5 stroke; no text glyphs. Only `1×` stays text.
- One `.lb-btn` recipe: a 44 px square (`--target-min`), `display: inline-flex` with `align-items` and
  `justify-content` centring, `box-sizing: border-box`; the old per-button type classes are gone.
- Toolbar grid: the counter, the status line and the close button share the same top inset, the same 44 px height and
  the same border and radius, so they sit on one centre line; prev and next are mirrored at the vertical middle and the
  zoom group is centred at the bottom.
- States: hover (only where hover exists) and pressed use `color-mix` of the overlay and on-overlay tokens, the
  focus ring is the shared `--color-focus-on-dark` ring, disabled ends stay flat at 40 % opacity.
- T-291 logic (touch-action, insets, page-zoom frame, snap to fit) is untouched.
- `scripts/lightbox-layout.mjs` now measures the SVG box, so "glyph centred in its button" checks the real icon
  (0.0 px offset at 360, 768 and 1280).

## Stuck after a pinch on a phone (T-291)

Cause: `touch-action: none` was set on the stage only, and only when `data-zoom="on"`. A pinch that began on a
button, the counter or the bare dialog (and any pinch on iOS) zoomed the browser's page instead of the photo. The
dialog is fixed to the layout viewport, so the close button then sat off screen, and because the stage forbids
browser gestures the page could not be pinched back out there. `npm run lightbox-a11y` now emulates a page scale
of 2.5 (`Emulation.setPageScaleFactor`) and asserts close, prev, next and counter stay inside the visible window.

Fix: `touch-action: none` on the whole dialog and the stage; `gesturestart` is cancelled (iOS); if the page is zoomed
anyway, `lightbox-viewport.ts` (`pageZoomFrame`) re-fits the dialog to the visible window (`data-page-zoomed`,
touch-action `pinch-zoom` so the browser can pinch out); a pinch ending within 5 % of fit snaps to exactly fit
(`settleView`); controls are above the stage (`z-index`) and clear of safe-area insets. Viewport meta is unchanged.
Tests: `lightbox-escape.test.ts` and the page-zoom block at the end of `scripts/lightbox-a11y.mjs`.
