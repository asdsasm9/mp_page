# Design tokens

Source of truth: `apps/web/src/styles/tokens.css` (declared once on `:root`, inside `@layer tokens`). Reset, typography, focus ring and skip link: `apps/web/src/styles/base.css`. Enforced by `apps/web/src/styles/tokens.test.ts` (token presence, contrast ratios, no raw hex or px in components, layouts and base.css).

The current look is kept (H-3 is open): ink on paper, warm accent, Martel. A later refresh changes only the token values. Light scheme only. No Tailwind (D-6).

## Differences from the autopilot-web skills (read 2026-10-19)

| Skill guidance | What WP-3 does | Why |
|---|---|---|
| design-tokens: dark values via `prefers-color-scheme` | Light only, `color-scheme: light` | Plan 4.3 and non-scope (no dark mode); the brand is a light photo portfolio. Dark mode would be a token-only addition later. |
| design-tokens: colours in `oklch()` | Hex and `rgb()` | Keeps the existing brand values verbatim (`#464646`, `#fafafa`, `rgb(227,204,180)`); the contrast test parses hex and `rgb()`. |
| design-tokens: names `--text-xs..3xl`, `--space-1..12`, `--duration-*`, `--focus-ring` | `--font-size-0..5`, `--space-1..8`, `--motion-*`, `--focus-width` plus `--focus-offset` | Plan 4.3 names; fewer steps because there are about 8 page types. Space is still a 4 px base. |
| design-tokens: semantic success, warning, info colours | Only `--color-danger` | No forms or status UI exist (no contact form, D-3). Add when needed. |
| design-tokens: Tailwind recipes | Not used | D-6: plain CSS plus tokens. |
| web-standards: `@layer reset, tokens, base, components, utilities` | Adopted exactly | |
| web-standards: logical properties, `dvh`, container queries | Adopted in base.css; container queries are decided per component | |
| web-standards: fonts `font-display: swap`, one variable font | Martel 400 static, `font-display: optional` with preload (plan 4.3) | Zero font-caused CLS; the one-weight budget is 2 files, 60 KB. |
| a11y: sticky header must not hide focus | `scroll-padding-block-start` = header height + space-4 | WCAG 2.4.11 |
| a11y: target 24 px minimum, aim 44 | `--target-min: 2.75rem` (44 px) | |
| perf-budget defaults (Perf 90, CSS 50 KB, JS 170 KB, hero 300 KB) | Stricter budget from docs/SEO.md section 9 (Perf 95, CSS 30 KB, JS 60 KB) | Plan 4.10 is the authority for this project. |
| visual-check: Playwright, `@axe-core/playwright`, light and dark screenshots | puppeteer-core plus axe-core plus lighthouse, light only, 360/768/1280 | D-6 approved list and plan 4.10 (no browser download). |

## Tokens

### Colour

| Token | Value | Use |
|---|---|---|
| `--color-bg` | `#fafafa` | Page background |
| `--color-surface` | `#f3f5f5` | Bands, cards |
| `--color-surface-raised` | `#ffffff` | Raised panels |
| `--color-text` | `#464646` | Body text, headings |
| `--color-text-muted` | `#5f5f5f` | Captions, meta |
| `--color-accent` | `rgb(227,204,180)` | Fills only (buttons, active nav marker); never text, and 1.5:1 to the page so never the only boundary |
| `--color-accent-hover` | `rgb(217,190,161)` | Hover of accent fills |
| `--color-on-accent` | `#464646` | Text on accent: ink, never white |
| `--color-border` | `#d9d9d9` | Decorative dividers only |
| `--color-border-strong` | `#767676` | Boundary of any control (needs 3:1) |
| `--color-focus` | `#1d4f91` | Focus ring on light surfaces |
| `--color-focus-on-dark` | `#f2d8b8` | Focus ring inside the lightbox |
| `--color-overlay`, `--color-on-overlay` | `rgb(20,20,20)`, `#fafafa` | Lightbox backdrop and its text |
| `--color-placeholder` | `#e6e6e6` | Image placeholder when no dominant colour |
| `--color-danger` | `#a4262c` | Error text |
| `--color-theme` | `#fafafa` | `theme-color` meta |

### Contrast (computed by the test, WCAG 2.x relative luminance)

| Foreground | Background | Ratio | Need |
|---|---|---|---|
| text | bg | 9.04 | 4.5 |
| text | surface | 8.63 | 4.5 |
| text | surface-raised | 9.44 | 4.5 |
| text-muted | bg | 6.12 | 4.5 |
| text-muted | surface | 5.84 | 4.5 |
| on-accent | accent | 6.10 | 4.5 |
| on-accent | accent-hover | 5.32 | 4.5 |
| danger | bg | 6.96 | 4.5 |
| on-overlay | overlay | 17.65 | 4.5 |
| border-strong | bg | 4.35 | 3 |
| border-strong | surface | 4.15 | 3 |
| focus | bg | 7.80 | 3 |
| focus | surface | 7.44 | 3 |
| focus | accent | 5.26 | 3 |
| focus-on-dark | overlay | 13.41 | 3 |

### Type, space, shape, motion, layout

| Group | Tokens |
|---|---|
| Type | `--font-body` (Martel then serif stack), `--font-size-0..5` (fluid `clamp()`, base at least 17 px), `--font-size-small`, `--line-height-body` 1.6, `--line-height-heading`, `--tracking-heading`, `--measure` 70ch |
| Space | `--space-1..8` = 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4.5 rem |
| Shape | `--radius-sm`, `--radius-md`, `--radius-full`, `--border-width`, `--focus-width`, `--focus-offset`, `--shadow-sm`, `--shadow-md` |
| Motion | `--motion-fast` 150 ms, `--motion-base` 250 ms, `--motion-ease`; anything beyond colour or shadow is inside `prefers-reduced-motion: no-preference` |
| Layout | `--layout-max`, `--layout-gutter`, `--header-height`, `--target-min` (44 px), `--z-header`, `--z-dialog`, `--z-skip` |

## Usage rules

- Components use `var(--...)` only. No hex, `rgb()`, or `px` in components or layouts (the test greps them). Border width uses `--border-width`.
- Body text is left-aligned, at most 70ch, 1.6 line height.
- Accent is a fill with ink text. A control that sits on the page in accent also has a `--color-border-strong` border so its boundary reaches 3:1.
- Every interactive element has a visible `:focus-visible` ring from base.css; do not remove it.
- Changing a colour token to a failing value turns `tokens.test.ts` red.
