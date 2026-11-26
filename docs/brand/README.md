# Brand

The README art: the mark, the card and the how-it-works figure. All of it is
written by [`scripts/brand.mjs`](../../scripts/brand.mjs); do not edit the SVGs
by hand. `npm test` fails when a committed file no longer matches the script.

```sh
node scripts/brand.mjs
```

It is drawn in the Aviation design system's tool-mark construction, the one
athanor and grimoire use: an ink square, paper linework, and the deck's amber
spent once, on the heatmap cell the loupe has found. The Builder UI keeps its
own star-atlas design ([`docs/DESIGN.md`](../DESIGN.md)); none of this touches it.

| File | Use |
|---|---|
| `lynceus/lynceus-mark.svg` | the mark, 40px and up |
| `lynceus/lynceus-mark-solid.svg` | the mark, 32px and below: fewer, larger cells |
| `lynceus/favicon.svg` | the mark, 16px |
| `lynceus-card.svg` | the README banner, 1280 by 640 |
| `lynceus-social.png` | the same card at 2560 by 1280, for the repository's social preview |
| `lynceus-how-it-works.svg` | the README's "How it works" figure |
| `fonts/` | IBM Plex Mono, regular and semibold, Latin-1 subsets, inlined into the card and figure. SIL Open Font License, in `fonts/OFL.txt` |

**The social preview.** GitHub takes a PNG or JPG, not an SVG, and it is set
by hand: Settings → General → Social preview → upload `lynceus-social.png`.
After changing the card, render it again at 2x from `lynceus-card.svg`, for
example with a headless Chromium:

```sh
chrome --headless=new --hide-scrollbars --force-device-scale-factor=2 \
  --window-size=1280,640 --screenshot=docs/brand/lynceus-social.png \
  docs/brand/lynceus-card.svg
```
