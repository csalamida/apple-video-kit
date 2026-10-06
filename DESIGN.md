# Apple Video Kit - Design System

The visual rules every template follows. Values live in `components/tokens.css` (the only place to change them); this page explains them. References for the language: Apple's [Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/). Not affiliated with Apple; no Apple assets ship with the kit.

## 1. Materials (glass)

Glass is translucent: the footage must show through, or it reads as a flat card.

| Token | Value | Use |
|---|---|---|
| `--glass-base` | `rgba(18, 18, 22, 0.50)` | default panel fill |
| `--glass-base-strong` | `rgba(24, 24, 28, 0.72)` | dense text over busy footage |
| `--glass-filter` | `blur(44px) saturate(170%) brightness(0.74)` | backdrop behind panels |
| `--glass-filter-thin` | `blur(28px) saturate(170%) brightness(0.8)` | small chips and pills |
| `--glass-border` | `0.5px solid rgba(255, 255, 255, 0.18)` | hairline edge |
| `--glass-shadow` | bright top inner edge, faint rim, soft ground shadow | key light at 12 o'clock |

Apply with the `hf-glass` class (templates) or `.glass` (tokens.css). A 1px specular rim, brightest at the top, comes from `::after`.

## 2. Shape

- Rectangles use continuous curvature: `corner-shape: var(--corner)` (`superellipse(2.2)`). Capsules and circles stay true arcs.
- Radii: cards 20-36px, pills fully round, screen-share window 18px, webcam card 42px, talking-head speaker PiP 36px.

## 3. Type

- Stack: `system-ui` first (SF Pro on Apple platforms, with automatic optical sizing; Segoe UI elsewhere). Mono: `ui-monospace`.
- Weights 400-700 only. No `text-shadow`.
- Tracking: `--track-display` -0.022em at 28px and up, `--track-title` -0.014em at 17-27px, `--track-label` +0.06em for uppercase micro labels.
- Numbers use tabular figures (`.tnum`). Sentence case everywhere; uppercase only for short labels.
- Minimum 14px at 1080p.

## 4. Colour

Apple system dark palette. One accent.

| Token | Value | Role |
|---|---|---|
| `--accent` | `#2997ff` | the only highlight colour (rings, active states, punch words) |
| `--accent-deep` | `#0a60d0` | filled buttons and pills behind white text |
| `--accent-text` | `#78bdff` | accent used as TEXT over footage (passes contrast) |
| `--green` | `#30d158` | done, positive, live |
| `--yellow` | `#ffd60a` | attention badges |
| `--label` / `-secondary` / `-tertiary` / `-quaternary` | white at 1 / .78 / .55 / .30 | text hierarchy |
| `--ink` | `#0b0b0f` | stage background |

Orange and red exist in tokens for UI states inside mock panels (warnings, errors); never as an accent. Text must pass WCAG AA; the HyperFrames check measures it.

## 5. Motion

- Spring eases only: `__hfGlass.ease.smooth` (no overshoot: camera, layout, opacity), `snappy` (slight settle: cards, pills), `bouncy` (playful: toasts, bubbles, checkmarks). GSAP ignores `cubic-bezier(...)` strings.
- Entrances 0.5-0.6 s from the side away from the face; exits 0.3-0.4 s `power2.in`.
- Camera and zoom moves 0.7-0.85 s smooth spring. Footage never re-crops while a window morphs.
- Every value is a pure function of time (renders seek in any order).

## 6. Layout

- 1920x1080 stage. Page margin 72px.
- Talking head: cards keep clear of the speaker's head (`place()` with the face track).
- Screen share: floating window 93.5% wide, centred, over a wallpaper; webcam card 267x427 bottom-left at (26, 24); captions bottom-centre.

## 7. Icons

The kit's own 24x24 set (`__hfParts.icon(name, size)`, `components/tpl-parts.js`), drawn in `currentColor`. Apple SF Symbols and Apple Color Emoji are not included: their licences do not allow redistribution.
