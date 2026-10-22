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
