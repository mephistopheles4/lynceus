```yaml
name: Lynceus
description: Observational star-atlas design system for the MEPH-6 GitHub App activity SVG workbench and init configurator, framing GitHub-native Light and Dark README renders inside indigo instrument plates.
colors:
  star-amber: "#B9381D"
  star-amber-hover: "#A32F17"
  star-amber-ink: "#FFFFFF"
  glow-amber: "#E8A878"
  night-sky: "#0A1021"
  indigo-plate: "#111B33"
  chart-blue: "#1B2A44"
  chart-blue-hover: "#233658"
  deep-well: "#090E1C"
  stardust: "#F2F2E9"
  slate-secondary: "#C5D0DF"
  slate-muted: "#96A5BA"
  copper-hairline: "rgba(232, 168, 120, 0.25)"
  copper-hairline-strong: "rgba(232, 168, 120, 0.48)"
  slate-border: "rgba(150, 165, 186, 0.22)"
  ephemeris-green: "#4ADE80"
  ephemeris-green-bg: "rgba(74, 222, 128, 0.11)"
  ephemeris-green-border: "rgba(74, 222, 128, 0.34)"
  alert-coral: "#FCA5A5"
  github-dark-canvas: "#0d1117"
  github-dark-ink: "#e6edf3"
  github-dark-muted: "#8d96a0"
  github-dark-border: "#30363d"
  github-light-canvas: "#ffffff"
  github-light-ink: "#1f2328"
  github-light-muted: "#59636e"
  github-light-border: "#d1d9e0"
typography:
  display:
    fontFamily: "'EB Garamond', Georgia, serif"
    fontSize: "2rem"
    fontWeight: 400
    lineHeight: 1.15
    letterSpacing: "0em"
  headline:
    fontFamily: "'EB Garamond', Georgia, serif"
    fontSize: "1.5rem"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "0.01em"
  title:
    fontFamily: "'Public Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "0em"
  body:
    fontFamily: "'Public Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0em"
  label:
    fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0.06em"
rounded:
  xs: "2px"
  seg: "3px"
  sm: "4px"
  md: "6px"
  full: "999px"
spacing:
  xs: "0.35rem"
  sm: "0.65rem"
  md: "1rem"
  lg: "1.25rem"
  xl: "1.5rem"
  2xl: "3rem"
components:
  button-primary:
    backgroundColor: "{colors.star-amber}"
    textColor: "{colors.star-amber-ink}"
    rounded: "{rounded.sm}"
    padding: "0.45rem 0.9rem"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.star-amber-hover}"
  button-secondary:
    backgroundColor: "{colors.chart-blue}"
    textColor: "{colors.stardust}"
    rounded: "{rounded.sm}"
    padding: "0.45rem 0.9rem"
    height: "36px"
  button-secondary-hover:
    backgroundColor: "{colors.chart-blue-hover}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.slate-secondary}"
    rounded: "{rounded.sm}"
    padding: "0.45rem 0.9rem"
    height: "36px"
  button-ghost-hover:
    backgroundColor: "{colors.chart-blue}"
    textColor: "{colors.stardust}"
  segmented-group:
    backgroundColor: "{colors.deep-well}"
    rounded: "{rounded.sm}"
    padding: "2px"
  segmented-button:
    backgroundColor: "transparent"
    textColor: "{colors.slate-muted}"
    rounded: "{rounded.seg}"
    padding: "0.34rem 0.58rem"
  segmented-button-active:
    backgroundColor: "{colors.chart-blue}"
    textColor: "{colors.stardust}"
  engraved-plate:
    backgroundColor: "{colors.indigo-plate}"
    textColor: "{colors.stardust}"
    rounded: "{rounded.md}"
    padding: "1.25rem"
  input-field:
    backgroundColor: "{colors.deep-well}"
    textColor: "{colors.stardust}"
    rounded: "{rounded.sm}"
    padding: "0.45rem 0.75rem"
    height: "36px"
  check-tile:
    backgroundColor: "{colors.deep-well}"
    textColor: "{colors.stardust}"
    rounded: "{rounded.sm}"
    padding: "0.5rem 0.65rem"
  tab-button:
    backgroundColor: "transparent"
    textColor: "{colors.slate-muted}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0.42rem 0.75rem"
  tab-button-active:
    backgroundColor: "{colors.chart-blue}"
    textColor: "{colors.stardust}"
  code-well:
    backgroundColor: "{colors.deep-well}"
    textColor: "{colors.slate-secondary}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0.9rem 1rem"
  ephemeris-pill:
    backgroundColor: "{colors.ephemeris-green-bg}"
    textColor: "{colors.ephemeris-green}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0.35rem 0.7rem"
  github-readme-dark:
    backgroundColor: "{colors.github-dark-canvas}"
    textColor: "{colors.github-dark-ink}"
    rounded: "{rounded.md}"
    padding: "1.5rem"
    width: "838px"
  github-readme-light:
    backgroundColor: "{colors.github-light-canvas}"
    textColor: "{colors.github-light-ink}"
    rounded: "{rounded.md}"
    padding: "1.5rem"
    width: "838px"
```

# Design System: Lynceus

## Overview

**Creative North Star: "The Observational Star Atlas"**

Lynceus treats GitHub App activity graphing as an astronomical observation workbench rather than a generic developer stats card. Drawn from the Celestial Star Atlas direction (`notation-diagram-systems-star-atlas`) and adapted for high-density Operate mode across `index.html` and `configurator.html`, the workbench mounts interactive controls inside deep indigo coordinate plates pinned with rotated copper-amber reticle diamonds over a quiet stippled night sky.

While the outer instrument adopts cartographic precision—editorial italic `EB Garamond` titling paired strictly with crisp `Public Sans` controls and tabular `JetBrains Mono` telemetry—the specimen inside the observation stage remains uncompromised. The simulated 838px GitHub Profile README frame and its zero-JavaScript exported SVGs stay quarantined on authentic GitHub Dark and GitHub Light surfaces so developers judge real README legibility and verify the integers-only privacy boundary at a glance.

Confirmed anti-references are strictly enforced across both surfaces: no SaaS hero-metric KPI tiles, no eyebrow or kicker labels above headings, no emoji or Unicode glyphs substituting for drawn SVG icons, no decorative gradient text or hard offset block shadows, and zero `<script>` tags or external font imports inside generated SVG exports.

**Key Characteristics:**

* Deep night-sky ground (`#0A1021`) with subtle prime-spaced celestial dot stipple (`271px`, `347px`, `419px`) behind indigo instrument plates (`#111B33`) and recessed wells (`#090E1C`).
* Four-corner rotated diamond reticle pins (`7px x 7px` at `45deg`) and dot-terminated copper-amber hairlines (`rgba(232, 168, 120, 0.25)`) framing every control and observation plate.
* Strict three-voice typographic discipline in the workbench: italic `EB Garamond` plate/brand headings, geometric `Public Sans` UI controls, and tabular `JetBrains Mono` readouts.
* Earned Star Amber (`#B9381D` / `#A32F17` hover) reserved exclusively for primary CTAs, brand star glyphs, active checkboxes, and magnitude peaks with 5.76:1+ white-text contrast.
* Complete palette and font isolation between the observatory shell and the embedded `838px` GitHub Dark (`#0d1117`) / GitHub Light (`#ffffff`) README simulator and exported SVGs.

## Colors

The palette pairs layered astronomical night navies and warm celestial copper accents in the observatory chrome against strictly quarantined GitHub Light and GitHub Dark specimen tokens inside the embedded README frame.

### Primary

* **Star Amber** (`#B9381D`): High-emphasis primary actions (`Customize Apps in init Configurator`, `Copy <picture> Markdown`, `Add Bot`, `Copy Output`), active checkbox accents, brand star marks, and peak magnitude legend dots. Achieves 5.76:1 contrast with pure white button ink (`#FFFFFF`).
* **Star Amber Hover** (`#A32F17`): Pressed and hover state for primary buttons, deepening luminance to 7.06:1 white-text contrast.

### Secondary

* **Glow Amber** (`#E8A878`): Warm copper instrument accent reserved for uppercase control labels, hyperlinks, corner reticle pin borders, section-rule terminal dots, active focus outlines, and discovered-app event totals (8.39:1 on indigo plates; 9.29:1 on night sky).

### Neutral

* **Night Sky** (`#0A1021`): Root canvas background and rotated corner-pin fill, overlaid with subtle zenith illumination (`rgba(36, 55, 79, 0.36)`) and sparse starlight stipple.
* **Deep Well** (`#090E1C`): Recessed container ground for segmented control tracks, inputs, selects, app roster lists, metric check tiles, empty dashed placeholders, and `counts.json` / `agent-graph.json` code wells.
* **Indigo Plate** (`#111B33`): Primary elevated instrument panel surface for toolbars, observation stages, configurator sections, and synthetic-data pills.
* **Chart Blue** (`#1B2A44`) and **Chart Blue Hover** (`#233658`): Active surface for selected segmented buttons, active route navigation links, selected inspector tabs, secondary buttons, and hover transitions inside recessed lists.
* **Stardust** (`#F2F2E9`): Primary high-contrast ink for headings, active controls, input text, and selected roster slugs (16.82:1 on Night Sky; 15.18:1 on Indigo Plate).
* **Slate Secondary** (`#C5D0DF`): Subtitles, ghost buttons, coordinate readouts, privacy metric summaries, and code-well text (10.96:1 on Indigo Plate).
* **Slate Muted** (`#96A5BA`): Inactive navigation links, unselected segmented/tab labels, section hints, placeholders, and chart scale labels (6.83:1 on Indigo Plate; 7.69:1 on Deep Well).
* **Copper Hairline** (`rgba(232, 168, 120, 0.25)`) and **Copper Hairline Strong** (`rgba(232, 168, 120, 0.48)`): Subtle structural plate borders, header dividers, dashed column rulers, and active/hover border emphasis.
* **Slate Border** (`rgba(150, 165, 186, 0.22)`): Fine `1px` containment strokes around recessed inputs, segmented tracks, roster rows, check tiles, and code wells.
* **Semantic Status Tokens**: **Ephemeris Green** (`#4ADE80` ink, `rgba(74, 222, 128, 0.11)` surface, `rgba(74, 222, 128, 0.34)` border) signals verified privacy seals (`COUNTS ONLY · 0 REPO NAMES · 0 TITLES`), active private-count scopes, and successful copy feedback; **Alert Coral** (`#FCA5A5`) highlights invalid slug inputs and validation errors (9.01:1 on Indigo Plate).
* **Isolated GitHub Specimen & SVG Ramps**: The simulated README frame and exported SVGs (`svg/generator.js`) use only authentic **GitHub Dark** (`#0d1117` canvas, `#161b22` badge/empty fill, `#21262d` divider, `#30363d` border, `#e6edf3` ink, `#8d96a0` muted) and **GitHub Light** (`#ffffff` canvas, `#f6f8fa` badge fill, `#eff2f5` empty cell, `#eaeef2` / `#d8dee4` divider, `#d1d9e0` border, `#1f2328` ink, `#59636e` muted), paired with six selectable 5-step per-agent SVG ramps (Emerald, Cobalt, Star Amber, Violet, Crimson, Teal) in `data/sample-datasets.js`.

### Named Rules

**The Instrument-vs-Specimen Isolation Rule.** Shell observatory tokens (`#0A1021`–`#1B2A44`, Star Amber `#B9381D`, Glow Amber `#E8A878`) govern only the workbench chrome; the simulated GitHub README frame and exported SVGs use only GitHub Dark (`#0d1117`), GitHub Light (`#ffffff`), and their isolated 5-step activity ramps so README fidelity is never tinted by the host UI.

**The Earned Amber Rule.** Primary Star Amber (`#B9381D`) is reserved strictly for decisive primary CTAs, brand star glyphs, checked checkbox accents, and magnitude scale peaks—keeping primary actions unmistakable against deep indigo surfaces while preserving >=5.76:1 white-text contrast.

## Typography

**Display Font:** `'EB Garamond'`, with `Georgia, serif` fallback
**Body Font:** `'Public Sans'`, with `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif` fallback
**Label/Mono Font:** `'JetBrains Mono'`, with `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` fallback

**Character:** Editorial cartographic elegance meets crisp operational clarity: slanted serif headings evoke celestial star plates while geometric sans controls and tabular monospace telemetry keep comparisons and JSON audits frictionless. Note that the observatory shell loads these three families via Google Fonts in this zero-build prototype, whereas simulated GitHub README frames and exported SVGs intentionally enforce GitHub's zero-network system stacks (`-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif` and `ui-monospace`).

### Hierarchy

* **Display** (`400` italic, `2rem` / `32px`, `line-height: 1.15`): Page-level `h1` plate headings (`Profile README Activity Prototypes`, `Universal App Discovery & Configurator`) in `EB Garamond` italic.
* **Headline** (`400` italic, `1.5rem` / `24px`, `line-height: 1`, `letter-spacing: 0.01em`): Top observatory brand wordmark (`Lynceus`) in `EB Garamond` italic.
* **Title** (`600`, `1.0625rem` / `17px`, `line-height: 1.5`): Configurator plate section headings (`Discovered GitHub Apps`, `Agent Labels & Color Ramps`, `Layout, Metrics & Privacy Scope`, `Live SVG Preview`, `Generated CLI Artifacts`) in `Public Sans`.
* **Body** (`400`–`500`, `1rem` base / `0.9375rem` subtitle capped at `68ch` / `0.875rem` buttons & inputs, `line-height: 1.5`): Descriptive guidance, controls, and roster labels in `Public Sans`.
* **Label** (`400`–`500`, `0.75rem` / `12px`, `line-height: 1.5`, `letter-spacing: 0.06em`–`0.08em`, uppercase on control labels and brand tags): Copper-amber control labels, telemetry readouts, ephemeris pills, tab buttons (`0.78rem`), and code wells (`0.76rem`, `line-height: 1.55`) in `JetBrains Mono` with `tabular-nums`.

### Named Rules

**The Semantic Monospace Rule.** `JetBrains Mono` with `tabular-nums` is restricted to machine identifiers (`<slug>[bot]`), `viewBox` and byte-size telemetry, `counts.json` code wells, uppercase copper control labels, tabs, and privacy audit pills—never decorative body prose or page headings.

**The Heading-Stands-Alone Rule.** Page and plate headings carry their own weight without eyebrow or kicker labels stacked above them.

## Layout

The workbench and configurator share a centered `1400px` max-width page shell (`padding: 1.5rem 1.5rem 3rem`, tightening to `1rem` horizontal padding at `<= 720px`) anchored beneath a sticky translucent header (`z-index: 30`, `rgba(10, 16, 33, 0.94)` with `backdrop-filter: blur(8px)`, reverting to static positioning below `720px`).

* **Workbench (**`index.html`**)**: Stacks a compact two-row comparison toolbar plate (`margin-bottom: 1.35rem`) directly above the full-width observation plate housing the `838px`-max simulated GitHub README specimen. Switching to Side-by-Side mode activates a 2-column equal grid (`repeat(2, minmax(0, 1fr))`, `gap: 1.5rem`) that collapses to a single column below `1120px`.
* **Configurator (**`configurator.html`**)**: Uses an asymmetric two-column grid (`minmax(0, 1.05fr) minmax(0, 0.95fr)`, `gap: 1.5rem`, `align-items: start`), pinning the right preview and artifact inspector column (`position: sticky; top: 4.75rem`) on desktop and unsticking into a single stack below `1060px`.
* **Spacing Rhythm & Responsive Grids**: Tight `0.35rem` vertical stacks join labels to inputs; `0.65rem`–`0.75rem` gaps organize button clusters, tab bars, and 2-column discovery controls (stacking at `<= 720px`); `1rem`–`1.25rem` padding and gaps give each plate breathing room; `1.5rem` separates major grid columns. Metric checkboxes form a 3-column grid collapsing to 2 columns at `<= 720px`, while pinned README repository cards collapse from 2 columns to 1 at `<= 720px` and reveal the horizontal-scroll SVG pan note.
* **Browser Surfaces**: Text selection (`rgba(212, 77, 46, 0.35)`), caret (`#E8A878`), link underline offset (`3px`), focus rings (`2px solid #E8A878`), and thin `8px` custom scrollbars (`#24374F` over `#0A1021`) are explicitly styled to match the atlas palette.

## Elevation & Depth

Depth is achieved primarily through **calibrated tonal plane layering** across four navy-indigo surfaces rather than heavy drop-shadow stacking. Containers sink or rise predictably according to operational role: recessed tracks and code wells sit lowest (`#090E1C`) beneath the ambient night sky (`#0A1021`), instrument plates lift cleanly (`#111B33`) with crisp `1px` copper-amber hairlines, and active controls rise to `Chart Blue` (`#1B2A44`) or `Star Amber` (`#B9381D`).

### Shadow Vocabulary

* **Plate Shadow** (`box-shadow: 0 12px 32px rgba(3, 6, 15, 0.45)`): Applied exclusively to observatory plate containers to ground raised control and observation panels above the starfield canvas.
* **Active Control Inset Hairline** (`box-shadow: inset 0 0 0 1px rgba(232, 168, 120, 0.48)`): Applied to active segmented buttons (`aria-pressed="true"`) to sharpen selected edges inside recessed tracks without altering button dimensions.
* **Selected Swatch Separation Ring** (`box-shadow: 0 0 0 2px #090E1C`): Creates a clean `2px` dark gap between an active circular color-ramp swatch and its `2px` Stardust selection border.

### Named Rules

**The Recessed-Well Rule.** Data rosters, `counts.json` code wells, segmented button tracks, and text inputs sink into `Deep Well` (`#090E1C`) beneath the `Indigo Plate` (`#111B33`) plane; selected segments, tabs, and secondary buttons rise to `Chart Blue` (`#1B2A44`).

**The Single-Offset-Shadow Rule.** Only structural instrument plates carry a soft ambient offset shadow (`0 12px 32px rgba(3, 6, 15, 0.45)`); zero-blur neobrutalist block shadows and diffuse colored halos are prohibited.

## Shapes

The system favors **crisp rectilinear instrument geometry** with restrained radii (`4px` small radius on buttons, inputs, segmented tracks, roster frames, tabs, pills, check tiles, and code wells; `6px` medium radius on observatory plates, GitHub README specimens, pinned repo items, and outer SVG card `<rect rx="6">`; `3px` on individual segmented buttons and synthetic-note badges; `2px` on intensity legend squares). Full `999px` circles are reserved exclusively for magnitude dots, section-rule terminal points, and color-ramp swatches.

Three signature celestial motifs define the hardware language:

* **Corner Reticle Pins**: Every major corner-pinned plate carries four `7px x 7px` rotated `45deg` diamond pins (`1px solid #E8A878` filled with `#0A1021`) centered `-4px` past each corner.
* **Terminated Section Rules**: Configurator plate headers connect `Public Sans` headings to monospace hints with a `1px` horizontal copper-amber hairline ending on the right in a `5px` `Glow Amber` circular dot (hidden below `720px`).
* **Dashed Calibration Dividers**: `1px dashed` rules mark boundaries for the `838px` README column ruler, side-by-side Option A/B layout comparisons, and empty-state prompts.

State transitions run at a brisk `160ms cubic-bezier(0.2, 0.7, 0.2, 1)` with a tactile `translateY(1px)` active button press, accompanied by one authored `190ms cubic-bezier(0.16, 1, 0.3, 1)` opacity settle (`0.72` to `1`) whenever SVG graphs re-render.

## Components

### Buttons

Tactile, flat-rectilinear action triggers (`4px` radius, `36px` min-height, `0.45rem 0.9rem` padding; `30px` min-height and `0.3rem 0.65rem` padding for compact small buttons) with inline `13px–16px` `<svg>` icons.

* **Shape:** Tight `4px` corner radius, `1px` border.
* **Primary:** `Star Amber` (`#B9381D`) background, `#FFFFFF` text, matching `#B9381D` border, shifting to `#A32F17` on `:hover`.
* **Hover / Focus:** `160ms cubic-bezier(0.2, 0.7, 0.2, 1)` color/border shift, `translateY(1px)` on `:active`, `2px solid #E8A878` (`outline-offset: 2px`) on `:focus-visible`, `opacity: 0.45` on `:disabled`, and `ephemeris-green` transient copied-confirmation state on clipboard actions.
* **Secondary / Ghost:** Secondary uses `Chart Blue` (`#1B2A44`) with `Slate Border` (`rgba(150, 165, 186, 0.22)`), brightening to `#233658` + `Copper Hairline Strong` on `:hover`. Ghost uses transparent background with `Slate Secondary` (`#C5D0DF`) ink, filling with `#1B2A44` and `#F2F2E9` ink on `:hover`.

### Segmented Controls

Compact single-axis switches for presets, themes, layouts, windows, detail density, marks, labels, and privacy scope.

* **Style:** Recessed `Deep Well` (`#090E1C`) track (`2px` padding, `4px` radius, `1px` `Slate Border`) holding `3px`-radius `0.8rem` buttons (`0.34rem 0.58rem` padding, `500` weight, `Slate Muted` `#96A5BA` ink).
* **State:** Active button (`aria-pressed="true"`) lifts to `Chart Blue` (`#1B2A44`) with `Stardust` (`#F2F2E9`) ink and a `1px` inset `Copper Hairline Strong` (`rgba(232, 168, 120, 0.48)`) ring.

### Engraved Plates & Section Rules

Primary structural panels on both the Workbench and Configurator.

* **Corner Style:** `6px` medium radius pinned on all four corners with `7px x 7px` rotated `45deg` `Glow Amber` diamond reticles.
* **Background:** `Indigo Plate` (`#111B33`) with `1px solid rgba(232, 168, 120, 0.25)` border.
* **Shadow Strategy:** Soft ambient `0 12px 32px rgba(3, 6, 15, 0.45)` plate shadow.
* **Internal Padding:** `1.25rem` (`0.9rem 1.2rem` on compact toolbar plates), with plate headers bridging headings and hints via a dot-terminated `1px` copper hairline.

### Inputs & Check Tiles

Data entry fields, app selection rows, ramp pickers, and privacy-scope indicators in `configurator.html`.

* **Style:** `Deep Well` (`#090E1C`) background, `4px` radius, `1px` `Slate Border` (`36px` min-height, `0.45rem 0.75rem` padding on inputs/selects; `0.5rem 0.65rem` on metric check tiles), `17px` `Star Amber`-accented checkboxes, and `24px` circular split-diagonal color-ramp radio swatches.
* **Focus & Validation:** Hover shifts border to `Copper Hairline Strong`; focus applies `Glow Amber` border with `2px solid rgba(232, 168, 120, 0.28)` outline; invalid slugs (`aria-invalid="true"`) switch border and live helper text to `Alert Coral` (`#FCA5A5`).

### Tabs & Code Wells

Live CLI configuration, Markdown snippet, and `counts.json` privacy audit inspection pane.

* **Style:** Bottom-bordered tab strip (`padding-bottom: 0.5rem`, `1px` `Slate Border`) of `0.78rem` `JetBrains Mono` buttons (`4px` radius, `0.42rem 0.75rem`) paired with a `Deep Well` (`#090E1C`) scrollable `<pre>` well (`0.76rem`, `line-height: 1.55`, `max-height: 360px`, `0.9rem 1rem` padding).
* **State:** Hover fills `Chart Blue` (`#1B2A44`); active (`aria-selected="true"`) adds `Copper Hairline Strong` border and `Stardust` ink.

### Navigation & Ephemeris Pills

Sticky top observatory header shared across routes.

* **Style:** Translucent `Night Sky` (`rgba(10, 16, 33, 0.94)` with `backdrop-filter: blur(8px)`), italic `EB Garamond` `1.5rem` brand wordmark beside an uppercase `0.75rem` mono tag divided by a `1px` copper hairline, route pills (`4px` radius, `0.45rem 0.85rem`), and right-aligned monospace privacy-seal (`ephemeris-green`) + synthetic-data (`indigo-plate`) status pills (`0.35rem 0.7rem`).

### Simulated GitHub README Frame & Exported SVGs

Authentic `838px`-max specimen enclosure isolating GitHub Light and Dark README rendering from the Star Atlas chrome.

* **Style:** `6px` radius, `1.5rem` padding (`1rem` mobile), authentic GitHub system sans/mono stack, `1px` host border (`#30363d` Dark / `#d1d9e0` Light), `1.375rem` profile title, synthetic-note badge (`3px` radius), horizontal-scroll-safe SVG viewport frame, optional `1px dashed` Option A/B comparison divider, and 2-column pinned repository grid. Generated SVGs (`580px` wide for 26w, `820px` wide for 52w, `rx="6"`) embed zero `<script>` tags and zero external font/URL references.

## Do's and Don'ts

### Do:

* **Do** isolate all simulated GitHub README frames and exported SVGs strictly on GitHub Dark (`#0d1117`) and GitHub Light (`#ffffff`) palettes with zero `<script>` tags and zero external font imports.
* **Do** layer interactive surfaces cleanly along the four depth planes: `Deep Well` (`#090E1C`) for recessed tracks/inputs/code wells, `Night Sky` (`#0A1021`) for ground, `Indigo Plate` (`#111B33`) for pinned panels, and `Chart Blue` (`#1B2A44`) for active selections.
* **Do** reserve `Star Amber` (`#B9381D`) for high-priority primary CTAs, brand star glyphs, checked checkbox accents, and peak magnitude markers so its rarity preserves clear action hierarchy at >=5.76:1 white-text contrast.
* **Do** pair italic `EB Garamond` display headings strictly with `Public Sans` UI controls and `JetBrains Mono` (`tabular-nums`) for `<slug>[bot]` handles, coordinates, uppercase control labels, tabs, and `counts.json` code wells in the workbench shell.
* **Do** keep browser chrome surfaces (`::selection`, `caret-color`, custom `8px` scrollbars, `:focus-visible` `2px` `Glow Amber` rings) themed from the Star Atlas palette.
* **Do** draw all UI icons as crisp inline `<svg>` paths (`13px–20px`, `1.5–1.6` stroke weight or solid 4-point star) consistent with the celestial atlas instrument language.

### Don't:

* **Don't** place eyebrows or kickers above page or section headings; let italic `EB Garamond` and semibold `Public Sans` headings stand alone.
* **Don't** tint the simulated GitHub README frame or exported SVGs with Star Atlas navy, copper hairlines, or `EB Garamond`/`Public Sans` fonts.
* **Don't** add hard zero-blur offset block shadows (`box-shadow: 4px 4px 0`) or decorative zero-offset colored halos; use only the observatory plate shadow (`0 12px 32px rgba(3, 6, 15, 0.45)`) on plates and crisp `1px` borders on controls.
* **Don't** use thick (`>1px`) colored `border-left` or `border-right` accent stripes on cards, roster rows, or privacy callouts.
* **Don't** use monospace fonts for body descriptions or editorial headings, and don't substitute emoji or Unicode glyphs for drawn SVG icons.
* **Don't** replace real privacy boundary telemetry (`0 repo names · 0 titles`) or tabular counts with decorative KPI hero cards, gradient text, or uncalibrated sparklines.