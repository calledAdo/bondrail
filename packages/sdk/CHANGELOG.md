# Changelog

## 0.1.1

- Fix: package exports pointed at sources not included in the package (0.1.0 is broken; use 0.1.1)

## 0.1.0

Initial release (published with broken exports; use 0.1.1).

- Bondrail contract ABIs and typed account/bond clients.
- x402 resource handling, account-mediated settlement, manifests and buyer guards.
- EIP-2612 permits, indexed revenue scoring, portable credit profiles, implied yield and revenue triggers.
- ESM and TypeScript declarations for all ten entry points; Node.js 20+ and an external viem peer.
- Private workspace helpers bundled into the distribution.

Names and signed domains use Bondrail. This version requires matching contract deployments and fresh signatures/policies; the historical judged testnet deployment is unchanged. Testnet software; not audited.
