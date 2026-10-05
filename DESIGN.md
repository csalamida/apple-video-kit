# Apple Design System & Video Specification
## Grounded in Apple HIG, Design Resources, Icon Composer & SF Symbols

This document formalizes the production-grade design system for our Hyperframes video engine, derived directly from Apple's official design architecture:
1. **Human Interface Guidelines (HIG):** [developer.apple.com/design/human-interface-guidelines](https://developer.apple.com/design/human-interface-guidelines/)
2. **Apple Design Resources:** [developer.apple.com/design/resources](https://developer.apple.com/design/resources/)
3. **Icon Composer & Liquid Glass:** [developer.apple.com/icon-composer](https://developer.apple.com/icon-composer/)
4. **SF Symbols 5 & 6:** [developer.apple.com/sf-symbols](https://developer.apple.com/sf-symbols/)

---

## 1. Material Physics: "Liquid Glass" & Translucency

Apple interfaces do not use flat gaussian blurs. The macOS, iOS, and visionOS material model is governed by **optical refraction**, **specular reflection**, and **layered substrate depth**.

### The 4 Material Thickness Levels
```css
/* Ultra Thin: Subtle scrim for metadata overlays & secondary chips */
--apple-material-ultra-thin: rgba(255, 255, 255, 0.05);
/* Thin: Floating accessory bars & navigation pills */
--apple-material-thin: rgba(255, 255, 255, 0.08);
/* Regular: Standard application cards, PiP window docks & modals */
--apple-material-regular: rgba(18, 18, 24, 0.72);
/* Thick: Grounded dock bars, high-contrast subtitle containers */
--apple-material-thick: rgba(10, 10, 14, 0.88);
```

### The 3D Specular Bevel & Light Angle
Light in Apple UI originates from a virtual key light positioned at **12 o'clock** (top-center, slight elevation):
* **Top Specular Edge:** A 1px linear catch representing light entering the refractive surface: `linear-gradient(180deg, rgba(255, 255, 255, 0.28) 0%, rgba(255, 255, 255, 0.04) 100%)`.
* **Substrate Saturation Boost:** Translucent materials must apply `backdrop-filter: blur(32px) saturate(190%)` so colors behind the glass retain chromatic vibrancy rather than muting to mud.
* **Ambient Occlusion & Elevation:** Multi-stop shadow:
  `box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3), 0 24px 64px -12px rgba(0, 0, 0, 0.65), inset 0 1px 1px rgba(255, 255, 255, 0.3);`

---

## 2. Continuous Curvature (Apple Squircles)

Standard CSS `border-radius: Xpx` creates circular arcs meeting straight lines with curvature discontinuities ($G0$/$G1$ tangent mismatch). Apple hardware and software strictly use **continuous curvature (superellipses / squircles, $G2$ continuity)**:

* **Formula:** $|x/a|^n + |y/b|^n = 1$, where $n \approx 4.5$ to $5.0$.
* **Figma / Sketch Equivalent:** `corner-smoothing: 100%`.
* **Standard Radii Tokens:**
  * Small chips / pills: `100px` (true capsule).
  * Feature cards / PiP docks: `22px–28px` with squircle geometry.
  * Hero containers / device screens: `36px–48px`.

---

## 3. Typography Architecture: San Francisco Optical Sizing

The San Francisco font system (`SF Pro`) is engineered with optical size thresholds that must never be mixed:

| Optical Family | Threshold | Tracking Rule | Characteristics & Usage |
| :--- | :--- | :--- | :--- |
| **SF Pro Display** | $\ge 20\text{pt}$ ($20\text{px}$) | Negative tracking ($-0.02\text{em}$ to $-0.045\text{em}$) | Tighter apertures, high contrast, elegant terminals. Used for Hero Headlines, Key Metrics, and Section Titles. |
| **SF Pro Text** | $< 20\text{pt}$ ($< 20\text{px}$) | Neutral to positive tracking ($0.0\text{em}$ to $+0.02\text{em}$) | Open counters, wider proportions, larger x-height. Used for Subtitles, Captions, and Body Copy. |
| **SF Mono** | Any size | Fixed-width tabular (`+0.04em`) | Timecodes, technical telemetry, and code blocks. |

### Color & Contrast Tokens (WCAG AA Certified)
* **Primary Label:** `#ffffff` (100%)
* **Secondary Label:** `rgba(235, 235, 245, 0.75)`
* **Tertiary Label:** `rgba(235, 235, 245, 0.50)`
* **Quaternary / Scrim:** `rgba(235, 235, 245, 0.20)`
* **System Accents:**
  * **Electric Blue:** `#2997ff` (Standard) / `#389eff` – `#4da6ff` (High-contrast glass punch).
  * **System Green:** `#30d158` (Status positive / completion).
  * **System Orange:** `#ff9f0a` (Caution / energy).
  * **System Red:** `#ff453a` (Live status indicator / alert).

---

## 4. SF Symbols 5 & 6 System: Rendering Modes & Motion Presets

All vector icons in our production engine adhere to the **SF Symbols Specification**:

### The 4 Rendering Modes
1. **Monochrome:** Vector path rendered with a single flat color (`fill: currentColor`).
2. **Hierarchical:** A single accent color rendered across 3 optical depths:
   * Primary Layer: $100\%$ opacity
   * Secondary Layer: $32\%$ opacity
   * Tertiary Layer: $15\%$ opacity
3. **Palette:** Custom multi-tone mapping (e.g. Blue `#2997ff` body + White `#ffffff` badge).
4. **Multicolor:** Apple's native semantic multicolor iconography (Weather, Battery, Cloud).

### The 6 Native Symbol Motion Effects
All symbol transitions must utilize one of Apple's standard motion behaviors:
* **Bounce:** Directional elastic overshoot (`0.45s, cubic-bezier(0.34, 1.56, 0.64, 1)`).
* **Scale:** Subtle emphasis breathing (`1.0x` $\rightarrow$ `1.15x` $\rightarrow$ `1.0x`).
* **Pulse:** Rhythmic opacity pulsing of secondary/tertiary layers (`1.0` $\rightarrow$ `0.4` $\rightarrow$ `1.0`).
* **Variable Color:** Sequential wave lighting across segments (signal bars, soundwaves, loaders).
* **Replace:** Morphing cross-dissolve with scale transition between glyphs.
* **Appear / Disappear:** Staggered layer entrance.

---

## 5. Hardware Frames & Production Templates (Design Resources)

When presenting code, demos, or captured media, frame them using authentic Apple device bezels:
* **MacBook Pro Frame:** 16" Liquid Retina XDR profile with top camera notch and 2px aluminum border.
* **iPhone 16 Pro Frame:** $440 \times 956\text{pt}$ aspect ratio, Titanium rounded perimeter, and animated **Dynamic Island** pill ($126 \times 37\text{px}$).
* **Studio Display:** Micro-texture glass border with subtle top webcam indicator.
