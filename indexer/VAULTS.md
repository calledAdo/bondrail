# Vault history

`gen-config.mjs` reads optional `vaultFactory` and `vaultFactoryStartBlock` from the manifest.
The original `vault` is statically indexed from the protocol start block; factory-created vaults
are discovered by `VaultCreated`. This retains deposits/transfers before legacy registration.
Metadata absent from events is null until registration, which preserves existing accounting.
Constructor curator logs may precede dynamic discovery; `VaultCreated` supplies the curator.
Strategy metadata is disclosure, never an enforced Native/Watched filter.

`VaultPosition` tracks shares from Transfers and remaining deposit cost from Deposits. Transfers
carry pro-rata cost; burns remove it before Withdraw, which tracks withdrawn assets separately.
This is deposit-cost accounting, not taxable cost basis or market purchase price. Reindex from
inception; transfers exceeding a known position fail rather than inventing basis.

`Vault` stores running deposits, withdrawals, deposit/withdrawal shares, allocations, collections,
raise withdrawals and checkpointed income. Supply comes only from mint/burn Transfers, avoiding
double counting ERC-4626 events. `lockedIncome` is the last emitted checkpoint, not currently
unvested income. Curator proposals and changes are recorded directly from events.

`VaultHolding` stores per-bond cumulative allocation/collection/raise-withdrawal totals, outstanding
allocated claims, remaining cost basis and active membership. Allocated claims mint 1:1 with assets;
Funding claims cannot transfer, so RaiseWithdrawn removes the exact pro-rata cost. Collection clears
the entire holding, including any subsequently donated claims. `Vault.holdings` is the curator's
tracked set, not a list of unsolicited bond receipts. Removed holdings retain their cumulative history.

`VaultDailySnapshot` now contains UTC-day sums of the same flows, event count, closing event-derived
supply and the last emitted locked-income checkpoint. Time comes from `event.block.timestamp`.
`realizedPrice` is the last Deposit/Withdraw ratio **that day**: `floor(assets * 1e18 / shares)` in raw
units. `realizedPriceKind` and `realizedPriceTimestamp` identify the observation. Zero-share events
have no price. With no Deposit/Withdraw that day, price is null; quiet days have no rows. Nothing is
sampled, carried forward or fabricated. `VaultActivity` includes Transfers, per-event realized prices
and emitted locked income. Event IDs remain chain:block:transaction:logIndex.

The web app converts raw ratios using live asset/share decimals and labels both charts
**“30-day realized price at deposits/withdrawals”**. Only priced days appear; the line connects those
observations across gaps. Prices mix entry and exit executions and can differ due to impairments,
rounding and income vesting. They are not NAV, performance returns or current transaction quotes.
Live NAV, entry/exit prices, idle cash and holdings valuations remain current-block RPC reads in the
web app. The local Anvil adapter reconstructs the same aggregates from logs and block headers;
it performs no historical vault state calls and adds no quiet-day samples.

## Breaking schema migration (Task 23d)

- Removed `VaultDailySnapshot.entryPrice`, `exitPrice`, `nav`, `entryNav`, `idle`.
- Added daily flow totals, `eventCount`, `lockedIncome` and nullable realized price/kind/timestamp.
  Retained IDs, vault/day/timestamp/block and `totalSupply` (now derived from Transfers).
- Added running flow totals, supply, holdings, locked checkpoint and nullable realized price fields
  to `Vault`. Metadata `asset`, `owner`, `curator`, `name`, `symbol`, `strategy`, `metadataHash` is
  nullable for legacy vaults until events establish it. An empty registry means unregistered.
- Added `VaultHolding`. Added nullable `VaultActivity.realizedPrice` and `lockedIncome`.
  `VaultPosition` is unchanged.

A **full reindex from inception** is required; do not reuse historical RPC snapshots or resume an
old database against this schema. Regenerate Envio types and update GraphQL consumers together.
`vaultState`, `blockTime`, their effects and the 300-block sampler are removed. No
`VAULT_SNAPSHOT_RPC_URL`/`MONAD_RPC` configuration is needed by handlers. Hosted release/reindex
is a separate operator action; local acceptance does not change cloud state.
