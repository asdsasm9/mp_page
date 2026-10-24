# Design tokens

Source of truth: `apps/web/src/styles/tokens.css` (declared once on `:root`, inside `@layer tokens`). Reset, typography, buttons, focus ring, skip link, reduced-motion and print layers: `apps/web/src/styles/base.css`. Enforced by `apps/web/src/styles/tokens.test.ts` (token presence, contrast ratios, the type rules, no raw hex or px in components, layouts and base.css, the accent rule, and that this document names every token).

The look since WP-12 (T-274) is "Classical": warm paper, ink, a gold accent used as a stroke, Cormorant Garamond headings and Lora body text, hairlines, outlined buttons, no radius on images and buttons. A later refresh changes only the token values. Light scheme only. No Tailwind (D-6). The admin mirrors every non-type token (`apps/admin/src/styles/tokens.css`, checked by its `tokens.test.ts`).

## Differences from the autopilot-web skills (read 2026-10-19)

| Skill guidance | What this project does | Why |
|---|---|---|
| design-tokens: dark values via `prefers-color-scheme` | Light only, `color-scheme: light` | Plan 4.3 and non-scope (no dark mode); the brand is a light photo portfolio. Dark mode would be a token-only addition later. The Reference band is a fixed dark token set (`--band-dark-*`). |
| design-tokens: colours in `oklch()` | Hex, plus `rgb()` with alpha for the scrim | Keeps the brand values verbatim; the contrast test parses hex. |
| design-tokens: names `--text-xs..3xl`, `--space-1..12`, `--duration-*`, `--focus-ring` | `--text-display..nav`, `--space-1..8`, `--motion-*`, `--focus-width` plus `--focus-offset` | Fewer steps because there are about 8 page types. Space is still a 4 px base. |
| design-tokens: semantic success, warning, info colours | Only `--color-danger` | No forms or status UI exist (no contact form, D-3). Add when needed. |
| design-tokens: Tailwind recipes | Not used | D-6: plain CSS plus tokens. |
| web-standards: `@layer reset, tokens, base, components, utilities` | Adopted exactly | |
| web-standards: logical properties, `dvh`, container queries | Adopted in base.css; container queries are decided per component | |
| web-standards: fonts `font-display: swap`, one variable font, `size-adjust` fallback | Two static faces (Cormorant Garamond 400, Lora 400), each latin and latin-ext, `font-display: swap`, metric-matched local fallbacks | The typeface is the brand now. Four files because Czech needs latin-ext on nearly every screen. |
| a11y: sticky header must not hide focus | `html { scroll-padding-block-start: var(--header-height) }`, no `scroll-margin` on sections | WCAG 2.4.11; one mechanism, so offsets cannot add up. |
| a11y: target 24 px minimum, aim 44 | `--target-min: 2.75rem` (44 px) | |
| perf-budget defaults (Perf 90, CSS 50 KB, JS 170 KB, hero 300 KB) | Stricter budget from docs/SEO.md section 9 (Perf 95, CSS 30 KB, JS 60 KB) | Plan 4.10 is the authority for this project. |
| visual-check: Playwright, `@axe-core/playwright`, light and dark screenshots | puppeteer-core plus axe-core plus lighthouse, light only, 360/768/1280 | D-6 approved list and plan 4.10 (no browser download). |

## Tokens

### Colour

| Token | Value | Use |
|---|---|---|
| `--color-bg` | `#f6f4f1` | Page background |
| `--color-surface` | `#ece7e0` | Alternate band (O mně, Kontakt) |
| `--color-surface-raised` | `#ffffff` | Raised panels (admin) |
| `--color-text` | `#201f1d` | Body text, headings |
| `--color-text-muted` | `#605d5d` | Captions, meta |
| `--color-accent` | `#b68235` | DECORATION ONLY: hairline under a card title, kicker rule, the skip link fill. Never text, never the only boundary of a control (3.07:1 on the page, 2.74:1 on the band) |
| `--color-accent-strong` | `#a06f24` | Border of outlined buttons and the framed nav item (3:1 on page and band); source of the hover tint |
| `--color-accent-text` | `#7d5411` | Accent-coloured text (hover state of a text button, small labels) |
| `--color-accent-hover` | `#a06f24` | Hover colour for text and links. As a button FILL under dark text it gives only 3.8:1, so the admin has its own `--color-accent-fill-hover` |
| `--color-on-accent` | `#201f1d` | Text on an accent fill: ink, never white |
| `--color-border` | `#d4d2cf` | Hairline divider (the text colour at 16% over the page); decorative only |
| `--color-border-strong` | `#767676` | Boundary of any form control (needs 3:1) |
| `--color-focus` | `#7d5411` | Focus ring on light surfaces |
| `--color-focus-on-dark` | `#e1ad66` | Focus ring on dark surfaces (Reference band, hero, lightbox); selected with `[data-tone='dark']` |
| `--color-overlay`, `--color-on-overlay` | `#201f1d`, `#f6f4f1` | Lightbox backdrop, hero scrim base, and their text |
| `--scrim-hero-from`, `--scrim-hero-to` | overlay colour at alpha 0 and 0.7 | Gradient under the hero text. 0.7 because the bundled hero has a white dress where the text sits (F12); the final value is confirmed by the measured contrast check in T-277 |
| `--color-placeholder` | `#e6e6e6` | Image placeholder when no dominant colour |
| `--color-danger` | `#a4262c` | Error text |
| `--color-theme` | `#f6f4f1` | `theme-color` meta |
| `--band-dark-bg`, `--band-dark-text`, `--band-dark-muted`, `--band-dark-accent` | `#201f1d`, `#f6f4f1`, `#bab6b6`, `#e1ad66` | The Reference band. A token set, so another band colour later is a token edit |

Accent rules: `--color-accent` is used for `border-color`, `text-decoration-color` and hairlines only (the test greps components, layouts, pages and base.css for it as `color:` or `background:`; the only exemption is the `.skip-link` rule in base.css). Buttons are outlined in `--color-accent-strong`; accent-coloured text is `--color-accent-text`.

### Contrast (computed by the test, WCAG 2.x relative luminance)

| Foreground | Background | Ratio | Need |
|---|---|---|---|
| text | bg | 15.00 | 4.5 |
| text | surface | 13.39 | 4.5 |
| text | surface-raised | 16.47 | 4.5 |
| text-muted | bg | 5.94 | 4.5 |
| text-muted | surface | 5.30 | 4.5 |
| accent-text | bg | 6.08 | 4.5 |
| accent-text | surface | 5.42 | 4.5 |
| accent-strong | bg | 3.99 | 3 |
| accent-strong | surface | 3.56 | 3 |
| accent | bg | 3.07 | 3 (decoration only) |
| accent | surface | 2.74 | below 3 on purpose: the negative test keeps it from being used as a boundary |
| on-accent | accent | 4.89 | 4.5 |
| danger | bg | 6.61 | 4.5 |
| on-overlay | overlay | 15.00 | 4.5 |
| border-strong | bg | 4.14 | 3 |
| border-strong | surface | 3.69 | 3 |
| focus | bg | 6.08 | 3 |
| focus | surface | 5.42 | 3 |
| focus-on-dark | band-dark-bg and overlay | 8.13 | 3 |
| band-dark-text | band-dark-bg | 15.00 | 4.5 |
| band-dark-muted | band-dark-bg | 8.20 | 4.5 |
| band-dark-accent | band-dark-bg | 8.13 | 4.5 |

### Space, shape, motion, layout

| Group | Tokens |
|---|---|
| Space | `--space-1`, `--space-2`, `--space-3`, `--space-4`, `--space-5`, `--space-6`, `--space-7`, `--space-8` = 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4.5 rem |
| Shape | `--radius-none` (0: images, cards and buttons), `--radius-sm`, `--radius-md`, `--radius-full` (lightbox round buttons, admin), `--border-width`, `--focus-width`, `--focus-offset`, `--bar-thickness` (2 px), `--shadow-sm`, `--shadow-md`, `--opacity-disabled` (0.45) |
| Motion | `--motion-fast` 150 ms, `--motion-base` 250 ms, `--motion-drawer` 400 ms, `--motion-ease`; anything beyond a colour change, including smooth scrolling, is inside `prefers-reduced-motion: no-preference` |
| Layout | `--layout-max` 110rem, `--layout-gutter`, `--header-height` 85 px, `--section-pad`, `--section-gap-lg`, `--section-gap`, `--heading-gap`, `--drawer-width`, `--target-min` (44 px), `--target-compact` (32 px) |
| Image shapes | `--ratio-category` 3 / 4, `--ratio-album` 4 / 5, `--cover-position` |
| Stacking | `--z-header` 10, `--z-dialog` 20 (lightbox), `--z-drawer` 21 (inside the header), `--z-skip` 30 |

## Usage rules

- Components use `var(--...)` only. No hex, `rgb()`, or `px` in components or layouts (the test greps them). Border width uses `--border-width`.
- Body text is left-aligned, at most 70ch, 1.6 line height (`.t-prose`: 1.8 for long reading).
- Type (T-252): no `font-size`, `font-family`, `font-weight`, `line-height` or `letter-spacing` in any page, layout or component. Use the element defaults (h1, h2, h3, p) or a `.t-*` class from base.css. `tokens.test.ts` fails on a literal anywhere outside tokens.css and on a non-`var()` value in base.css. Uppercase (`text-transform`) is set only by `.t-display`, `.t-h1`, `.t-h3`, `.t-kicker`, `.btn` and `.btn-ghost`.
- Buttons: `.btn` (outlined, `--color-accent-strong`, uppercase, 44 px minimum height, no radius) and `.btn-ghost` (text with a 1 px accent underline). Hover tints use `color-mix()` of `--color-accent-strong` at 12% and 22%.
- Every interactive element has a visible `:focus-visible` ring from base.css; do not remove it. On a dark surface set `data-tone="dark"`.
- Changing a colour token to a failing value turns `tokens.test.ts` red.

## Type system (T-252, WP-12)

One global scale in `tokens.css`. Headings are `--font-heading` (Cormorant Garamond), everything else `--font-body` (Lora). Only weight 400 of each is loaded, so `--weight-body` and `--weight-heading` are both 400 and `base.css` sets `font-synthesis: none`: no faux bold or italic anywhere, hierarchy comes from size, case, tracking and colour. Rules, all in `tokens.test.ts`: Cormorant is never set under 20 px (`--text-h3` is the smallest heading level, h4 is Lora); uppercase headings have leading of at least 1.12 (`--leading-caps`) because Czech carons and rings (ČŘŠŽĚŮ) would touch the line above at the design's 1.02; the label levels `--text-kicker` and `--text-nav` are at least 12 px; the four body levels stay in a narrow range (at most 0.7 rem between min and max) and the headline levels `display`, `title`, `h1`, `quote` scale on purpose.

| Token | Class / element | 360 px | 1280 px | Line height | Use |
|---|---|---|---|---|---|
| `--text-display` | `.t-display` | 38 | 76.8 | `--leading-caps` 1.12 | home hero h1, uppercase |
| `--text-title` | `.t-title` | 34 | 53.8 | `--leading-heading` 1.2 | statement titles (O mně, Kontakt) |
| `--text-h1` | `h1`, `.t-h1` | 30 | 46 | 1.2, `.t-h1` 1.12 | page and section heads (`.t-h1`: uppercase, tracking `--tracking-h1`) |
| `--text-h2` | `h2` | 24 | 28 | 1.2 | sub-heads |
| `--text-h3` | `h3`, `.t-h3` | 22 | 24.6 | 1.2, `.t-h3` 1.12 | card titles (uppercase, tracking `--tracking-card`), lightbox arrows |
| `--text-quote` | `.t-quote` | 24 | 40 | `--leading-quote` 1.35 | reference quote (Cormorant) |
| `--text-lead` | `h4`, `.t-lead` | 17 | 18.4 | `--leading-lead` 1.5 | intro paragraph |
| `--text-body` | `body`, `.t-body` | 15 | 16.1 | `--leading-body` 1.6 | running text |
| `--text-small` | `.t-small` | 14 | 14.9 | `--leading-ui` 1.5 | footer, breadcrumb, secondary links |
| `--text-caption` | `.t-caption` | 13 | 13.8 | 1.5 | meta lines, counters |
| `--text-kicker` | `.t-kicker` | 12 | 12.8 | 1.5 | uppercase label, tracking `--tracking-label` 0.2em |
| `--text-nav` | `.btn`, `.btn-ghost`, `.t-nav` | 12 | 12.8 | 1.5 | nav and button labels, uppercase |
| `--text-wordmark` | `.t-wordmark` | 20 | 26 | `--leading-caps` 1.12 | header wordmark, uppercase, tracking `--tracking-wordmark` |

Other type tokens: `--leading-prose` 1.8 (`.t-prose`), `--leading-none`, `--tracking-heading` 0.03em, `--tracking-h1` 0.06em, `--tracking-card` 0.04em, `--tracking-label` 0.2em, `--tracking-wordmark` 0.14em, `--measure` 70ch.

The admin keeps its own denser scale (`--font-size-*`) and its own `--tracking-heading`; `apps/admin/src/styles/tokens.test.ts` compares only non-type tokens with the web, plus `--font-body`.

## Fonts

| Face | Package (exact pin) | Files | Bytes |
|---|---|---|---|
| Cormorant Garamond 400 | `@fontsource/cormorant-garamond` 5.3.0 | `cormorant-garamond-latin-400-normal.woff2`, `cormorant-garamond-latin-ext-400-normal.woff2` | 22,876 and 19,888 |
| Lora 400 | `@fontsource/lora` 5.3.0 | `lora-latin-400-normal.woff2`, `lora-latin-ext-400-normal.woff2` | 21,148 and 12,016 |

Total 75,928 bytes (74.2 KB), well under the 120 KB hard cap; the gate budget is 4 files and 84 KB (`BUDGET` in `apps/web/src/lib/weight.ts`, docs/SEO.md section 9). All four are preloaded in `components/Fonts.astro`, served from our own origin, no font CDN. Weight 400 only (the design never uses 600). `font-display: swap` with two metric-matched local fallbacks declared in `fonts.css` (`Cormorant Fallback` from Times New Roman, size-adjust 97.1%; `Lora Fallback` from Georgia, size-adjust 104.6%; computed with fontTools from the average advance of a Czech sample sentence). `fonts.test.ts` parses the cmap of every WOFF2 (node:zlib Brotli, no dependency) and asserts every Czech letter and the typographic marks `„“–—·×…'` are present in the face that serves them; it also records, as a documented negative, that neither face has arrow glyphs (arrows are inline SVG).

Licence: both families are SIL Open Font License 1.1 (Cormorant Garamond by Christian Thalmann / Catharsis Fonts, Lora by Cyreal), free for self-hosting and commercial use. The files are used unmodified (no subsetting beyond what the packages ship), so no reserved-font-name question arises. The same four faces are declared in `apps/admin/src/styles/fonts.css`; the admin UI still uses `--font-ui`, so no font file is fetched there until the admin restyle uses `--font-body`.
