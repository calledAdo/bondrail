# Facilitator gas diagnosis — next / Monad testnet

Snapshot: 2026-10-15 at block **71,319,823** (18:10:35 UTC). Wallet: `0x0CE7D559B9A87E600a117F5A3EdBb6B552028B36`. No chain writes, deployment, private-key access, or `~/.slice` reads were performed. All calls used `https://testnet-rpc.monad.xyz`.

## Finding: 0.0284941505 MON per mined settlement after the top-up

The reported **0.3419 MON spend is real**, but **three HTTP successes is not the number of on-chain settlements**. The wallet mined **12 successful `account.settle` transactions** after the top-up, costing **0.341929806 MON** in total. The average is **0.0284941505 MON**, not 0.114. Dividing that same spend by three HTTP successes yields 0.113976602 MON per observed HTTP success, which measures an application/reconciliation problem as well as gas expenditure.

| Period | Wallet nonces | Successful settles | Reverts / mined cancellations | Gas spend (MON) | Balance after (MON) |
| --- | --- | ---: | ---: | ---: | ---: |
| Initial 0.5 MON, 07:28:46–08:02:52 UTC | 0–19 | 20 | 0 | 0.495606576 | 0.004393424 |
| After +0.35 MON, 18:03:24–18:04:02 UTC | 20–31 | 12 | 0 | 0.341929806 | 0.012463618 |
| Entire wallet history through snapshot | 0–31 | 32 | 0 | **0.837536382** | **0.012463618** |

All 32 transactions have zero native value, destination `0x067861e4bf4803a66DB97cF74E252B6F4927FA54` (the next agent account), selector `0xbc28300c` (`settle`), receipt status 1, and a matching `Settled(payer,10000,authorizationNonce)` event. The 32 authorizations are distinct. Each receipt's `gasUsed` equals its transaction's `gasLimit`; on this Monad deployment that is the charged gas, **not a measurement of EVM execution alone**. For every transaction, the historical wallet balance decrease equals `gasLimit × effectiveGasPrice` exactly.

All observed effective prices are **102 gwei** (100 gwei block base fee + 2 gwei priority). All transaction fee caps are **182.4 gwei**. The cited 279,369-gas settlement costs **0.028495638 MON**; its old maximum fee commitment is **0.0509569056 MON**. `maxFeePerGas` is a ceiling, not the price actually charged. The six base-fee samples from a later five-block `eth_feeHistory` query also remained at 100 gwei; `eth_gasPrice` at the initial read was 102 gwei.

## Why pending does not imply an unmined transaction

Both `eth_getTransactionCount(latest)` and `eth_getTransactionCount(pending)` returned **32**, also confirmed on a later read. The mined nonces are contiguous **0–31**. There is no evidence of a current mempool transaction blocking this wallet, a mined nonce gap, an authorization-used revert, or a fee replacement/cancellation that consumed gas. Rejected, dropped or replaced-before-inclusion transactions consume **zero chain gas**; ordinary RPC history cannot enumerate their unknown hashes or reconstruct an earlier mempool. It cannot establish that no such attempts ever occurred.

The last balance, **0.012463618 MON**, is positive but below even one observed warm settlement's **~0.02849 MON** effective charge, and below the old **~0.05096 MON** fee commitment. The earlier **0.004393424 MON** balance was likewise insufficient. Having a positive balance did not mean the next transaction was affordable.

The previous facilitator had two concrete failure paths:

1. It signed and stored only a hash before send, omitted an explicit gas-funding check, and swallowed every broadcast error. A rejected send or crash before send could permanently leave a hash-only journal entry that would never mine. Retries only polled that hash.
2. A transaction could mine while receipt polling, the facilitator HTTP call, or the outer agent request failed. The agent retained generated work as `settlement_pending`, and ordinary retries never retried settlement or reconciled its receipt. Thus an HTTP 202 could refer to an already-paid request.

**The exact seven HTTP calls cannot be classified from the address alone.** Their hashes/payment keys and payer authorization nonces were not supplied, and private runtime journals were deliberately not read. The post-top-up spend includes twelve distinct successful authorizations from five payers (counts 3, 3, 2, 2, 2), more than the ten calls in the observation. The last ten transactions (22–31) alone cost 0.28494567 MON, but identifying them as those ten HTTP calls without request identities would be an assumption. For each pending request, match payer + authorization nonce against the evidence file: a match requires agent receipt reconciliation; an absent hash with no receipt needs investigation of the old journal/send failure. Do not label all seven as unmined or issue replacement payer authorizations on that assumption.

## Reproduction and transaction evidence

[Machine-readable evidence](./FACILITATOR-GAS-transactions.json) includes full hashes, blocks/times, payer/authorization nonce, gas limit, receipt gas used/status, base/effective/max/priority fees and exact before/after balances.

The RPC has no standard address transaction-list method. Historical `eth_getTransactionCount(address,block)` was binary-searched between block 71,189,270 (nonce 0) and 71,319,823 (nonce 32), taking 185 sampled blocks and locating 32 nonce-changing blocks. Full `eth_getBlockByNumber` responses identified the sender's transactions. Each receipt and block-adjacent balance was fetched; all calldata and `Settled` events were decoded locally. Separate `eth_getTransactionByHash` calls confirmed all twelve post-top-up transaction objects. No explorer estimates or gas-price oracle assumptions are used in the spend totals.

Every row below has **status 1**, **gasUsed = gasLimit**, **effectiveGasPrice = 102 gwei**, **maxFeePerGas = 182.4 gwei**. Full hashes are in the evidence JSON.

| Nonce | Block | Gas limit / receipt gas used | Cost (MON) | Transaction hash prefix |
| ---: | ---: | ---: | ---: | --- |
| 0 | 71192947 | 371,475 | 0.03789045 | `0xabf04773976f802c` |
| 1 | 71192972 | 233,167 | 0.023783034 | `0x93362ca704d5fb07` |
| 2 | 71192995 | 233,146 | 0.023780892 | `0x14368ca6a7576c24` |
| 3 | 71193013 | 233,155 | 0.02378181 | `0x2cbdb6c2784e09e9` |
| 4 | 71193029 | 233,134 | 0.023779668 | `0xa53235bfd4a141bc` |
| 5 | 71193043 | 212,336 | 0.021658272 | `0x83b6fb9706944435` |
| 6 | 71193065 | 212,336 | 0.021658272 | `0x8627c9f7e4531f82` |
| 7 | 71193079 | 212,357 | 0.021660414 | `0xca233c84046d7c52` |
| 8 | 71193097 | 212,348 | 0.021659496 | `0x15775bc22354265c` |
| 9 | 71193122 | 212,369 | 0.021661638 | `0x12c57883c87e88ef` |
| 10 | 71193138 | 212,348 | 0.021659496 | `0x740d64b8a26118a3` |
| 11 | 71193155 | 212,348 | 0.021659496 | `0x8f41120cf06cdb0a` |
| 12 | 71193169 | 212,357 | 0.021660414 | `0xeb6ad1ed6622c16a` |
| 13 | 71193194 | 212,369 | 0.021661638 | `0xec54a603009b826f` |
| 14 | 71193212 | 212,324 | 0.021657048 | `0x29c49fb6fa9270a1` |
| 15 | 71199628 | 313,876 | 0.032015352 | `0x4b8338a0b9aa38b1` |
| 16 | 71199655 | 279,336 | 0.028492272 | `0x8b0a5e326960169f` |
| 17 | 71199677 | 279,369 | 0.028495638 | `0x639ac7caf6e844e1` |
| 18 | 71199697 | 279,369 | 0.028495638 | `0x239698df79b223e9` |
| 19 | 71199719 | 279,369 | 0.028495638 | `0x4f3fca2e60f3483b` |
| 20 | 71318396 | 279,356 | 0.028494312 | `0x468529f5ae5cd128` |
| 21 | 71318402 | 279,312 | 0.028489824 | `0x6735c63ca5581cc8` |
| 22 | 71318408 | 279,369 | 0.028495638 | `0x7a69ab5951937c36` |
| 23 | 71318415 | 279,369 | 0.028495638 | `0xa044f57e52251e24` |
| 24 | 71318425 | 279,348 | 0.028493496 | `0x51bb05fcc0ea25a1` |
| 25 | 71318432 | 279,369 | 0.028495638 | `0xcaec2405d54b2436` |
| 26 | 71318443 | 279,356 | 0.028494312 | `0x4871c41800cb10c2` |
| 27 | 71318450 | 279,336 | 0.028492272 | `0x7b53c5d04911accf` |
| 28 | 71318456 | 279,369 | 0.028495638 | `0x9ae587a652cd3b85` |
| 29 | 71318462 | 279,369 | 0.028495638 | `0x9004309fce3253c4` |
| 30 | 71318496 | 279,356 | 0.028494312 | `0xd90cb947097121b8` |
| 31 | 71318523 | 279,344 | 0.028493088 | `0xf9513343a5b30828` |

## Implemented policy and recovery

- Gas: `ceil(eth_estimateGas × 1.15)`, default hard cap **500,000**. An over-cap estimate is refused as `gas_limit_exceeded`, never clipped into an out-of-gas transaction. The cap admits the observed cold estimate (371,475 × 1.15 → 427,197).
- Fee: latest block base fee plus **2 gwei** priority; max fee has **10% base-fee headroom**, capped by `FACILITATOR_MAX_FEE_GWEI` (default **150**). At a 100 gwei base, initial max fee is **112 gwei**, effective price **102 gwei**. If the cap cannot cover base + tip, refuse `gas_fee_cap_exceeded` without a new journal entry.
- Funding: check latest wallet balance against `gasLimit × maxFeePerGas` before signing/journaling and again before sending. An initial refusal returns `success:false`, `transaction:""`, `errorReason:"insufficient_gas_funds"`, logs required/available wei, and is safe to retry. It creates neither a wallet slot nor an authorization journal entry. A funding failure **after an earlier signed/broadcast attempt** remains pending with a hash and never claims no charge.
- Nonce: explicitly use the latest mined nonce only when pending nonce agrees. Persist a full signed transaction and one wallet slot **before** the authorization journal/broadcast. New authorizations wait for that slot to finish (`wallet_busy`, empty hash), so a timeout cannot allocate later nonces or create a gap. A startup/15-second monitor repairs interrupted journal writes, checks all saved hashes and rebroadcasts identical bytes. Retain one writer process and one durable namespace per gas key.
- Stalls: after 30 seconds without a receipt, replace the same nonce and calldata with both fees increased by **more than 12.5%**, still within the absolute cap and funding budget. Save every attempt before broadcast and accept a successful receipt for any saved settlement attempt. When its authorization is within six seconds of expiry, replace with a **21,000-gas, zero-value self-transfer** at that same nonce; a cancellation is always `settlement_cancelled`, never payment success. Reverts and consumed nonces release the slot; unknown replacements never prove payment.
- Hard bounds remain hard: an exhausted balance or fee cap may prevent even a cancellation. The slot stays reserved, later settlements are refused, and logs/health identify the recovery failure until the operator funds the wallet or deliberately changes the cap. An unknown pre-upgrade/foreign pending nonce is `wallet_nonce_blocked`; do not guess its transaction or silently overwrite it. The runbook covers this migration case.
- Legacy hash-only journals remain receipt-only. They contain neither signed bytes nor a proven wallet nonce, so a safe automatic replacement cannot be reconstructed. Preserve and reconcile them; do not delete them to force a fresh charge.
- `/health` reports native/wei balance, a conservative estimated next settlement cost, reserved worst-case cost of all outstanding attempts, settlements remaining, mined/pending/active nonce, low-balance status and recovery error. Before the first estimate after restart it uses the 500,000 cap. It never exposes signed bytes or a key. The HTTPS preview facade forwards this route.
- Low balance: logs `facilitator_low_gas_balance` when fewer than **10** estimated settlements remain; optional `FACILITATOR_LOW_BALANCE_WEBHOOK_URL` receives JSON with a five-second deadline and at most one alert per five minutes per process. The 15-second monitor runs even without paid traffic. Hook failure is logged and does not fail settlement.
- Agent: a definitive empty-hash funding/busy/fee-cap refusal returns **503, `charged:false`, `retryable:true`** and retains the generated answer. Retrying the identical signed request atomically retries settlement without rerunning the model. Ambiguous outcomes still return 202 and require receipt reconciliation.

## Cost and operating budget

Monad charges the entire submitted gas limit. At a stable 100 gwei base + 2 gwei tip:

| Estimate basis | New gas limit | Effective cost (MON) | Initial funding requirement at 112 gwei (MON) |
| --- | ---: | ---: | ---: |
| 120,000 passthrough execution estimate | 138,000 | 0.014076 | 0.015456 |
| 190,000 active-bond execution estimate | 218,500 | 0.022287 | 0.024472 |
| 279,369 observed live RPC/transaction limit, **if returned as estimate again** | 321,275 | 0.03277005 | 0.0359828 |
| 371,475 observed cold limit, **if returned as estimate again** | 427,197 | 0.043574094 | 0.047846064 |

The first two rows use the task's benchmark approximations, not a new live measurement. No authorized unsettled payment was available for a live simulation during this read-only diagnosis. Existing limits were produced by viem/RPC estimation, **not a hard-coded large limit in this repository**. An RPC estimate may already include padding; adding 15% can increase the actual cost versus the observed ~0.02849 MON. This patch bounds and exposes cost and avoids funding/journal failures; it does not claim a measured gas reduction. Lowering the fee ceiling alone does not lower the observed 102 gwei effective price.

For **100 warm paid calls**, budget about **4 MON including ~0.4 MON reserve** using the observed-live-estimate row (~3.6 MON initial commitments). At the absolute configured gas/fee caps, one transaction commits at most **0.075 MON**; 100 arbitrary worst-case calls require **7.5 MON plus reserve**. A 0.5 MON warm wallet covers roughly 15 actual charges at the modeled live estimate, with conservative admission allowing fewer; it is a small rehearsal budget, not a durable deployment budget. Count paid observer/health probes and all other consumers sharing this facilitator. Alert below ten remaining settlements, replenish before a batch, and restrict public paid-request rates separately.

## Validation

Behavioral tests cover integer rounding/caps, fee headroom and replacement bumps, exact affordability boundary with zero journal writes, cold estimates, contiguous nonces under concurrency, pending-slot blocking, crash recovery before broadcast, lost send responses, original/replacement receipts, cancellation and foreign replacements, legacy journals, health reserves and throttled hooks. HTTP integration covers the real x402 client, funding refusal, `/health` and the preview facade. Agent tests cover cached-work retries and prohibit a no-charge claim when a hash exists.

Final validation on 2026-10-15:

- `pnpm -r test`: **180 passed**, zero failures, including **69 facilitator tests** and **20 agent tests**.
- `pnpm -r --if-present typecheck`: all **10 workspace packages** passed.
- `tsc -p scripts/tsconfig.json --noEmit` and `tsc -p indexer/tsconfig.json --noEmit`: passed.
- `git diff --check`, evidence arithmetic/unique authorizations and modified documentation links: passed.

Tests used mocked RPC/alert receivers and local HTTP sockets. Node 26 emitted its existing `module.register()` deprecation warning. No production rollout or live settlement was performed.
