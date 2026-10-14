# Bondrail interface

Based on Kokonut DS (docs/Robaire Design System.pdf), set dark-first for a DeFi product.
Monochrome, tight, quiet. Colour only where it means something.

## Brand
- Idea: *Revenue bonds for onchain businesses.* Businesses issue bonds; investors fund them; a share of revenue goes toward repayment.
- The recurring visual is **the split**: a payment arrives and a slice peels off (animated beam: payer to
  BondrailAccount to business and bond). Supporting motifs: the capital ribbon (released / escrowed /
  recovered), the live payment ticker, and the logo mark (a circle with one wedge cut out).
- Voice: plain sentences, concrete numbers, every claim checkable on-chain. No speculative APR, no
  invented customers or testimonials. Synthetic data is labelled.

## Foundations (Tailwind v4 + shadcn tokens, `next-themes` class `dark`, dark by default)
- Neutral tokens at 0% saturation. Hierarchy comes from white or black at an alpha step, never a new grey:
  /2–/5 hover washes and watermarks, /10–/20 hairlines and dashed frames, /60–/70 body and nav, 1.0 headings.
  Small text never below /60.
- Dark surfaces: background `#0a0a0a`, card `#0a0a0a`, border `#262626`, muted text `#a3a3a3`. Ink panels
  carry film grain (feTurbulence overlay). Light mode mirrors with black alpha on white.
- **Signals**, used sparingly (Tailwind 500, borders at /20). Never decorative: no coloured glows, mesh
  blobs or per-tier hues on marketing surfaces, which read as generic AI templates.
  - emerald: the investor slice and money returned to investors (the one accent on the site);
  - orange: warnings (dark period, coverage below 1.2×);
  - red: violation, default, destructive.
  - Tiers (Native / Watched) are told apart by label and icon, not colour. Charts may use the chart ramp.
- Type: Geist, headlines tracking −0.05em, UI −0.025em. Geist Mono for indices `(01)`, addresses, hashes
  and bracketed live figures `[184]`. Tabular figures everywhere numbers align.
- Space: 4 px base; section padding py-32 on the site. Radius: lg 8 px buttons and inputs, xl 12 px cards
  and framed hero, 2xl 16 px panels, full for pills.
- Depth without shadows: hairline, dashed frame (bento, empty states), ring plus hover lift, frosted tier.
- Motion: hover colour 200–300 ms; arrow nudge +4 px; label roll on the primary CTA; reveal on scroll once
  (y 20–30, 0.5 s); stagger 0.15 s cards / 0.05 s rows. `prefers-reduced-motion` drops reveals and the
  beam animation; colour transitions stay.

## Surfaces
- **Site** (`(site)`): monochrome framed hero (grain, one soft white light from above) with the split beam
  and a giant "Bondrail" watermark, live stats strip
  (number tickers), payment marquee, how it works, two tiers bento (Native / Watched), builders vs investors,
  trust disclosure FAQ with `(01)` indices, sponsor logos.
- **Docs** (`(docs)`, Fumadocs): same tokens; code blocks on ink panels.
- **App** (`(app)`): a financing workbench in the same language. A wide activity ledger plus a narrower
  decision panel instead of a grid of identical stat cards. The capital ribbon appears from the market card
  to the bond page. Network, transaction, indexing and service failures are explicit UI states.
- Mobile: rows collapse into labelled groups, 44 px controls, visible keyboard focus. Charts have text
  summaries and legends.

## Bondrail identity

Use the approved six-unit Split B and outlined wordmark in `brand/bondrail`. Product backgrounds are charcoal #202A27 and warm white #F6F5EF; mint #9FE8CA is the dark-theme brand accent. Preserve semantic warning and error colours. Use dedicated small-size favicon assets.
