# Account payment contention benchmark

`scripts/bench/parallel.ts` sends EIP-3009 `SliceAccount.settle` payments from N independent funded wallets to one account, then sends the same workload to N different accounts (one per wallet). Defaults: **20 wallets × 5 payments = 100 transactions per arm**. Both arms use the same asset, amount, wallets, contract implementation and bond mode. No facilitator or shared gas wallet serializes submission.

**Anvil only validates the harness; it does not execute transactions in parallel. Its timings cannot establish a Monad speedup.** No Monad run is included here. `DESIGN.md` records the decision about contract changes.

## Local dry-run

Use a dedicated, disposable Anvil instance. Local setup creates fresh contracts and funds deterministic development wallets; it sets automining for setup, one-second interval mining for measured payments, then restores automining. It never reads or writes `docs/deployments/`.

```sh
~/.foundry/bin/forge build --root contracts
~/.foundry/bin/anvil --host 127.0.0.1 --port 8545 --silent
# In another terminal, from the repository root:
npx -y pnpm@10.32.0 exec tsx scripts/bench/parallel.ts
BENCH_BOND=active npx -y pnpm@10.32.0 exec tsx scripts/bench/parallel.ts
```

The local fixture uses the actual factory, account clones and bond implementation with `MockERC3009`, whose signatures are verified on-chain. Active mode binds an approved `MockEarner`, funds/activates a Native bond on every account, and splits 20% atomically. The cap is deliberately beyond the whole workload. Fixture creation, funding, warmups, estimation, signing and accounting validation are outside the measured interval. No production contract is modified.

## Monad testnet (owner-operated)

Supply existing **settle-capable** accounts and already funded wallets. The older published deployments may lack `settle`; the script does not deploy or upgrade anything in Monad mode. All accounts must use the same EIP-3009 asset and implementation, and should be isolated from other traffic. Passthrough mode requires no attached bond; active mode requires every bond to be Active with enough remaining cap for the full run. Keep bond terms identical between fixtures. Each wallet needs at least `2 × (M + warmups) × BENCH_AMOUNT` token units plus gas for both arms and warmups; gas funding is checked before each batch. Use a dedicated gas-paying key per payer, with no pending transactions or other process using its nonce.

Put the N funded private keys in a JSON array in a file **outside this repository**, with permissions `0600`. Local development keys must never be used on testnet. Create a fixture JSON containing addresses only:

```json
{
  "asset": "0x...",
  "sharedAccount": "0x...",
  "separateAccounts": ["0x...", "0x..."]
}
```

`separateAccounts` must contain exactly N distinct addresses, all different from `sharedAccount`. For the two-account example set `BENCH_WALLETS=2`; otherwise provide 20 addresses and 20 keys.

```sh
BENCH_CHAIN=monad \
BENCH_RPC_URL=https://testnet-rpc.monad.xyz \
BENCH_KEYS_FILE=/absolute/path/outside/repo/bench-keys.json \
BENCH_FIXTURE_JSON=/absolute/path/bench-fixture.json \
npx -y pnpm@10.32.0 exec tsx scripts/bench/parallel.ts
```

The script pins chain ID 10143. It discovers the token's EIP-712 domain via ERC-5267 and validates its `DOMAIN_SEPARATOR`. For tokens without ERC-5267, also set `BENCH_TOKEN_NAME` and `BENCH_TOKEN_VERSION` to the token's actual signing domain. Incorrect domains fail before payments. Testnet mode never calls Anvil methods or funds wallets. Results contain addresses and transaction hashes, never private keys or the RPC URL.

For useful measurements run both `BENCH_ORDER=shared-first` and `BENCH_ORDER=separate-first`, repeat several times with comparable fixtures/network conditions, and increase N/M cautiously within the RPC provider's limits. RPC rate limits, the sequential nonce chain of each payer, network load and block gas limits can dominate results. Keep the same warmup policy, amount, bond terms, token and compiler settings when comparing implementations. Inspect failures and actual block occupancy before drawing conclusions. Inclusion at one confirmation is timed; finality and executor re-execution counts are not measured.

## Controls and output

| Environment variable | Default | Meaning |
|---|---|---|
| `BENCH_CHAIN` | `anvil` | `anvil` (31337) or `monad` (10143) |
| `BENCH_RPC_URL` | local `http://127.0.0.1:8545`; Monad public testnet RPC | Target endpoint |
| `BENCH_WALLETS` / `BENCH_PAYMENTS` | `20` / `5` | Distinct senders / measured payments per sender per arm |
| `BENCH_AMOUNT` | `1000000` | Smallest token units per payment; 1 token for a six-decimal asset |
| `BENCH_WARMUPS` | `1` | Untimed payments per wallet per destination before either arm; `0` measures cold history too |
| `BENCH_BOND` | `passthrough` | `passthrough` or `active`, applied equally to both arms |
| `BENCH_ORDER` | `shared-first` | `shared-first` or `separate-first` |
| `BENCH_POLL_MS` / `BENCH_TIMEOUT_MS` | `100` / `120000` | Receipt polling interval / timeout per transaction |
| `BENCH_BLOCK_SECONDS` | `1` | Local-only interval mining |
| `BENCH_OUTPUT_DIR` | `docs/bench` | Timestamped JSON and Markdown output directory |
| `BENCH_KEYS_FILE` / `BENCH_FIXTURE_JSON` | required on Monad | Existing funded wallets and account addresses |
| `BENCH_TOKEN_NAME` / `BENCH_TOKEN_VERSION` | discovered | Domain fallback; checked against `DOMAIN_SEPARATOR` |

Transactions are signed before timing, with explicit consecutive nonces. Each wallet submits its next transaction as soon as the RPC accepts the previous one, without waiting for receipts. Wallet streams run concurrently. Every receipt is tracked independently; the measured interval ends when all receipts/errors are observed. Polling can add approximately one polling interval plus RPC latency to observed inclusion latency. Signing and estimation use a 20% gas-limit margin; Monad charges on the limit, so reported receipt `gasUsed` is **not** a fee quote.

Each run writes:

- `<timestamp>-<chain>-<mode>.json`: configuration, chain/client and source revision, fixture addresses, per-transaction broadcast-to-receipt latency, receipt status, hash, block/index and gas; per-arm total wall/broadcast times, latency percentiles, gas distribution, block range, and counts for every block including empty ones. `txsPerBlock` counts only benchmark transactions over the inclusive block range; `chainTxs` shows total block traffic.
- The matching `.md`: a comparison table with links to raw data.
- `-shared-transactions.json` and `-separate-transactions.json`: early checkpoints so transaction hashes survive failures during block/statistics retrieval. Removed after the full successful report is saved; retained on failure.

Broadcast errors, reverts, receipt timeouts and accounting mismatches exit nonzero. An ambiguous broadcast stops that wallet's later nonce submissions; the known hash is retained for reconciliation. Do not rerun with pending nonces, or treat a partial/failed run as a performance comparison. Successful arms verify the exact `paymentCount()` and `cumulativeRevenue()` deltas against successful receipts. Warmup failure stops before measurements.

The requested baseline gas and sizes can be reproduced with:

```sh
~/.foundry/bin/forge test --root contracts --gas-report
~/.foundry/bin/forge build --root contracts --sizes
npx -y pnpm@10.32.0 exec tsc -p scripts/bench/tsconfig.json
```

Foundry's function gas table mixes cold/warm calls, no-ops and expected reverts; the dry-run receipt gas distributions measure successful `settle` transactions including transaction overhead. Do not compare the two as if they measure the same thing.
