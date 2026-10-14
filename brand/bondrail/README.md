# Bondrail identity and migration

Selected identity: Split B, six-unit channel. Mint `#9FE8CA`, charcoal `#202A27`, warm white `#F6F5EF`; outlined Geist wordmark.

## Twitter / X avatar

Upload `social/avatar-mint-512.png` (recommended, charcoal symbol on mint) or `social/avatar-dark-512.png` (mint symbol on charcoal). Both are 512×512 and padded for circular cropping. Use **Bondrail** as the display name. No handle availability is implied.

## Assets

`svg/`: transparent master marks and outlined horizontal lockups. `png/`: transparent high-resolution exports. `favicons/`: pixel-adjusted 16/24/32 variants and ICO. `social/`: square social avatars. Copied from the approved local Bondrail identity project; geometry unchanged. The upstream usage guide is `SOURCE-GUIDE.md`; its comparison/original links refer to the separate design project.

## Migration

Visible app and API branding, docs, metadata, passkey display names, root package name and workspace namespace now use Bondrail. Workspace imports use `@bondrail/*`; run `pnpm install --frozen-lockfile` after updating.

Compatibility retained intentionally:
- Deployed Solidity `Slice*` identifiers, ABIs, contract addresses and Solidity remappings.
- EIP-712 `Slice Profile` domain, so existing signed profiles remain verifiable.
- SDK function names (`sliceClient`, `sliceManifest`, `sliceGuard`) and error classes.
- `/.well-known/slice.json`, environment variables (`SLICE_*`), local key paths and storage keys.
- Infrastructure project IDs and the separate paid API URL remain stable. The web project is now `bondrail`, the primary URL is https://bondrail.vercel.app and GitHub is https://github.com/calledAdo/bondrail. The legacy web hostname remains available for existing passkeys.
- Historical build records and original demo evidence.

The demo presentation script and compositor are updated for Bondrail. Existing exported MP4s and raw transaction captures still show Slice and have not been mislabelled as rebranded footage. A fully rebranded video needs new read-only app captures plus an explicit treatment of historical transaction footage; never repeat successful financial operations solely for branding.

## Twitter header
Upload `social/bondrail-twitter-header.png` (1500×500). Includes 3000×1000 PNG and editable SVG with embedded Geist fonts. Lower-left reserved for avatar overlap; crop varies by client. Rebuild with `tools/make_header.py` using Pillow.

## Positioning
See [MESSAGING.md](MESSAGING.md) for the bond-first category, headline, audience copy, Twitter bio and product-claim boundaries.

## YouTube banner
Upload `social/bondrail-youtube-banner.png` (2560×1440, under6MB). The unchanged Twitter wording sits within the central1546×423 all-device safe area. `social/bondrail-youtube-mobile-preview.png` is a crop preview, not the upload file. Rebuild with `tools/make_youtube_banner.py` after regenerating the Twitter artwork.

## Explainer thumbnail
Use `social/bondrail-youtube-explainer-thumbnail.png` for the25-second explainer (1280×720PNG, under2MB). Rebuild with `tools/make_thumbnail.py`.
