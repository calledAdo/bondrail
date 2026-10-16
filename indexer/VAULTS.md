# Vault history

`gen-config.mjs` reads optional `vaultFactory` and `vaultFactoryStartBlock` from the manifest.
The original `vault` is statically indexed from the protocol start block; factory-created vaults
are registered dynamically. This retains deposits/transfers before legacy registration.

New indexed events: `VaultCreated`; vault `Deposit`, `Withdraw`, `Transfer`, `Allocated`,
`Collected`, `RaiseWithdrawn`, `CuratorProposed`, `CuratorChanged`, `IncomeCheckpointed`.
Constructor curator logs can precede discovery; `VaultCreated` supplies the current curator.
Strategy metadata is disclosure and never treated as an enforced Native/Watched filter.

`VaultPosition` tracks shares from Transfers and remaining deposit cost from Deposits. Transfers
carry pro-rata cost; burns remove it before the Withdraw event. Withdrawn assets are tracked
separately. This is deposit-cost accounting, not taxable cost basis or a market purchase price.
Reindex from inception; a transfer exceeding the known position fails rather than inventing basis.

`VaultDailySnapshot` stores the last observed block in each UTC day (entry/exit price per whole
share in asset units, both NAVs, idle and supply). All values come from historical `eth_call` at
that exact block. Event handlers refresh the daily row. A 300-block handler samples the first
block it observes each new UTC day even without activity, capturing income vesting/write-downs.
Missing days are not fabricated. RPC errors fail/retry indexing; no latest-state substitution.

Set `VAULT_SNAPSHOT_RPC_URL` to a historical-state RPC for the configured chain (Monad testnet
falls back to `MONAD_RPC` or the public RPC). Envio effects cache by chain, vault and block.
Hosted configuration/release remains an operator action; this task only generates local files.
The lightweight Anvil adapter reconstructs logs and historical valuations independently; it is
not an Envio deployment. Handler tests use Envio's test indexer with fully mocked RPC responses.
