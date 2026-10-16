# Changelog

## Unreleased

- Protocol-bound BondrailVaultFactory, named vaults, one-time exact-runtime legacy registration, and IBondrailVaultFactory. Existing vault code and hard limits are unchanged.

## 0.1.0

- Initial Solidity integration package, copied byte-for-byte from canonical `contracts/src` at prepack.
- `BondrailEarner`, shared types/interfaces, protocol implementations, and vault/credit registry interfaces.
- OpenZeppelin 5.4.0 dependency, npm/Foundry remappings, and an isolated tarball integration test.
- Testnet prototype; not audited.
