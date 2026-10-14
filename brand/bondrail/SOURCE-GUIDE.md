# Bondrail — refined Split B

Selected: **B / 6-unit gap**. The original gap was 10 units on a 96-unit grid. The selected master narrows it by 40%, extending the open ends of both bowls toward the spine. The outside silhouette, spine width, bowl curves and palette are unchanged.

## Review

- [Gap study](comparison/gap-study.png): original 10-unit gap, then 8, 6 and 4. The four study lockups use identical refined spacing to isolate the gap comparison. The lower before/after row compares original versus refined proportions at the same lettering scale.
- [Selected identity](comparison/selected-identity.png): light, dark, black and white.
- [Favicon proof](comparison/favicon-proof.png): real 16/24/32px PNGs on flat backgrounds, with nearest-neighbor enlarged views below.

SVG versions of all review boards are included. Annotation lettering on the boards is live text; the production logos are completely outlined.

## Why six units

| Gap | Assessment |
| --- | --- |
| Original / 10 | The spine feels detached, encouraging an IB reading. |
| A / 8 | An improvement, but the separation still dominates. |
| B / 6 — selected | The B reads more cohesively while its open channel remains visible. |
| C / 4 | Strong unity at large sizes, but the channel is only 0.67px wide in a direct 16px rendering. |

These are optical design judgments, not findings from audience testing. The dedicated micro artwork is deliberately adjusted to remain clear on the pixel grid.

## Production SVGs

Every file under `selected/svg/` has a transparent background, editable named path groups, and outlined Geist wordmark lettering. No fonts, gradients, filters, masks, strokes or external resources are required.

| Variant | Symbol | Wordmark | Intended surface |
| --- | --- | --- | --- |
| `light` | Charcoal `#202A27` | Charcoal `#202A27` | Warm white `#F6F5EF` |
| `dark` | Mint `#9FE8CA` | Warm white `#F6F5EF` | Charcoal `#202A27` |
| `mono-black` | `#000000` | `#000000` | White / light |
| `mono-white` | `#FFFFFF` | `#FFFFFF` | Black / dark |

`bondrail-symbol-*.svg` uses the 96×96 master grid. `bondrail-lockup-*.svg` uses a 504×122 canvas. Light/dark describes the intended background, not an opaque rectangle baked into the artwork. Proof boards show the intended surfaces.

## Optical balance and lettering

The wordmark remains Geist Regular (400), with the existing tightened tracking of −1.4 units per gap at a 100-unit em. Spelling and letterforms are unchanged. All eight letters are individually editable vector paths.

In the revised lockup, the symbol's visible height is 72.96 units against an approximately 70-unit capital B and 74-unit overall letter bounds. The symbol extends slightly above and below the wordmark's capital to compensate for its rounded bowls. Its bottom now aligns closely with the wordmark instead of hanging noticeably below it. The visible gap before the wordmark is approximately 23 units (about 0.31× the symbol height), reduced from approximately 43 units at equivalent lettering scale.

## Isolated favicon exports

`selected/favicons/` includes separate SVG and transparent PNG files at **16×16**, **24×24** and **32×32**, in all four colour variants. Each has only the mark, with no tile, label or wordmark. `favicon.ico` contains the light/charcoal versions at all three sizes.

Use the provided small-size files at their intended dimensions. Their flat edges are fitted individually to the pixel grid, with vertical clear channels of 1px, 1px and 2px respectively. Bowl openings and curves are adjusted subtly to avoid blurry fractional edges; they are optical micro variants of the six-unit master, not exact mathematical downscales. The comparison study uses unhinted downscales for a fair gap comparison.

Choose light/charcoal on light browser chrome and dark/mint or monochrome white on dark chrome. The supplied .ico is a light-theme fallback. For SVG-aware browsers, serve the appropriate variant for the colour scheme; no theme-switching script is embedded in the files.

## PNG and avatar exports

- Transparent symbols: 512px and 1024px square, all four variants.
- Transparent lockups: 1008×244px and 2016×488px, all four variants.
- Social avatars: 512px square SVG/PNG, charcoal on mint or mint on charcoal. The artwork is inset to remain inside a circular crop. Avatar backgrounds are intentionally opaque.

## Clear space and minimum sizes

- Allow at least **one spine width** around the visible mark: 14 units on the master grid, approximately 18% of the symbol's visible height. Measure from the artwork, not the canvas. Add outer margin if the standalone SVG's intrinsic padding is insufficient.
- For the horizontal lockup, use the same allowance: approximately 13.5 units in its 504×122 canvas. Its built-in outer padding meets that minimum.
- Recommended minimum horizontal lockup width: **144 CSS pixels** (about 35px canvas height); minimum visible capital height is approximately 20px.
- Minimum standalone symbol: **16px**, using the supplied size-specific favicon artwork. Use the master SVG for larger placements, particularly above 32px.
- Favicons are the intentional clear-space exception. Social avatars already have generous padding; retain their crop and scale.
- Keep aspect ratios fixed. Do not close the channels or use pale mint on a light surface. Keep the tagline separate from small lockups.

## Original preserved

`original/` contains exact copies of the original concept-01 SVG and PNG assets, including the original wordmark spacing. `checksums.json` records their SHA-256 hashes. The first-round files in `../concepts/` were not changed.

## Source

Rebuild with `node ../refine.mjs` from this directory. The builder reads the existing outlined wordmark data and uses the local Sharp installation documented in the project README. All delivered artwork works independently of those build dependencies.
