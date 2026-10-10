# Slice v1 specification

Single source of truth for the build. Supersedes everything in `docs/archive/`.
Decided 9 October 2026 (user + Claude). 10 October 2026: Locked tier removed; issuance and deposit checks; one asset per account (any token); payments out (`settleOut`); fee floor. Network: Monad testnet (10143); local anvil (31337) for tests.

## 1. Idea

A business's revenue flows through its **SliceAccount** from day one. The account records every payment
on-chain, with the real payer, and builds a credit history before the business ever asks for money.
When the business raises against that revenue, the account starts splitting a fixed share to a
**SliceBond**. When the bond ends, the account goes back to paying the business 100%.

## 2. Contracts

### SliceAccount (one per business, clone created by SliceFactory)
The business's revenue address and payment entrypoint. Replaces the earlier "router".

**One asset per account, any token.** `createAccount(asset)` fixes the token the business charges fees in
(USDC, WETH, WMON, ...). Fees, bonds, deposits, repayments and stake all use it; claims share its
decimals. No allowlist: Slice does not vet assets. The marketplace's default view promotes well-known
assets only and flags the rest. Fee-on-transfer tokens revert (balance checks); a downward rebase never
bricks the account (a shortfall books nothing).

**Bound parties**
- `issuer`: the business owner; withdraws the business's share, binds the project once.
- `project`: the Native project contract allowed to call `collect` (zero for Watched). Bound once by the issuer.
- `factory`: attaches and detaches bonds.

**Three ways money moves through it**
1. **In (Native).** The project calls `collect(payer, gross, fee)` or `collectWithPermit(...)`, for fees
   charged on what the payer sends (a buy).
   - The account pulls `gross` from `payer` (`transferFrom`; with EIP-2612 permit, no standing approval).
   - It keeps `fee` and sends `gross − fee` to the project. The payer is proven by the pull.
2. **Out (Native).** The project calls `settleOut(payer, gross, fee)`, for fees charged on what the payer
   receives (a sell paid in the quote asset).
   - The account pulls `gross` from the project (`SliceEarner._settleOut` approves exactly that), pays
     `gross − fee` to the payer and keeps `fee`. The payer approves nothing, so it works for tokens without
     permit (WETH) and for sellers who never bought here.
   - Either way the fee is split immediately; no keeper is needed. Native projects charge fees only in the
     account's asset; a fee earned in another token is converted by the project's own code first.
3. **Received.** A plain USDC transfer to the account: an x402 settlement, or anything else anyone sends.
   Anyone calls `sweep()` to book unrecorded balance as revenue. The contract cannot tell transfers
   apart; the indexer does (section 3): x402 settlements carry the payer's EIP-3009 signature, every
   other transfer is an unclassified inflow that never counts as verified revenue.

**Modes**
- **Passthrough** (no active bond, or bond still Funding): 100% of revenue is credited to the issuer.
- **Credit** (active bond): `revenueBps` of revenue goes to the bond, capped at the bond's remaining
  revenue cap. A rounding carry (`splitRemainder`) means micro-payments never round investors to zero.
  The rest is credited to the issuer.
- When the bond closes (cap, maturity) or is cancelled, the account detaches it and returns to passthrough.

**Credit history (on-chain, from the first payment)**
- `cumulativeRevenue`, `cumulativeVolume` (gross behind collected fees, in and out), `paymentCount`,
  `collectedCount`, `uniquePayers` (collected payers only),
  `firstRevenueAt`, `lastRevenueAt`.
- `revenueByDay[day]`.
- Bonds snapshot `cumulativeRevenue` at activation; the on-chain milestone reads the difference.

**Business share**: pull credit (`issuerCredit`, `withdraw(to, amount)`). A reverting recipient can
never block payments or investors.

### SliceBond (one per issuance, clone)
Vault plus ERC-20 claim (the asset's decimals, name and symbol per bond).
- **Funding:** deposits mint claims 1:1 until `raiseAmount`; every deposit requires `factory.depositAllowed(bond)` (below); transfers are locked while Funding; cancel and refund after `fundingDeadline`.
- **Activation:** issuer (via factory), only when fully funded and the source is healthy.
  - Releases `firstReleaseBps` (2500 or 5000) to the issuer; the rest stays as undrawn principal.
  - Snapshots `account.cumulativeRevenue()`.
- **Second release**, inside `[secondReleaseNotBefore, secondReleaseDeadline)`, source healthy, no default. Mode is fixed in terms:
  - `Onchain`: `account.cumulativeRevenue() − snapshot ≥ minRevenue` and `now ≥ activation + minOperatingPeriod`. Trustless; counts any revenue, including wash, which still costs the issuer real money.
  - `Signed`: an EIP-712 milestone from the factory's disclosed `milestoneSigner` (wash-adjusted off-chain).
- **Undrawn principal** becomes investor recovery if the deadline passes, the bond defaults, or collection closes.
- **Revenue cap** scales with released principal: `effectiveCap = repayCap × released / raise`.
- **Redeem at any time after activation** for `tokens × pool / supply`. The last claim waits for Closed.
- **Fee floor (Native, optional `minFeeBps`):** while the bond is Active, every `collect`/`settleOut` must
  carry `fee × 10 000 ≥ gross × minFeeBps`, so the issuer cannot cut its fee after raising. Watched bonds
  must set 0.
- **Default (Watched only):** stake slashed into the pool; undrawn principal goes to recovery.
- **Closing → Closed:** Watched bonds get a 120 s window for late evidence; Native bonds close immediately.

### SliceFactory
- `createAccount(asset)`; the issuer is `msg.sender`; `asset` is any ERC-20 contract reporting `decimals()`.
- `setNativeApproval(project, bool)`: the disclosed `reviewer` approves a Native project's code (it pays every fee through `collect`). History accrues before review; review is required to raise.
- The factory never deploys projects: Native projects inherit `SliceEarner` and bind themselves (`account.bindProject`, issuer only, the project must point at the account).
- `createBond(account, terms, config, name, symbol)`. Requires `minHistory` seconds (immutable, set at deploy:
  60 s local, 600 s testnet, days on mainnet) since the account's `firstRevenueAt`. Watched requires a stake.
- `depositAllowed(bond)`: Native, the project is still reviewer-approved, bound and pointing at the
  account; Watched, the bond has not defaulted and its latest CRE observation is not a Violation (no fresh
  report needed, so a bond can raise between CRE runs).
- `activate`, `releaseSecond(bond)` (on-chain mode), `releaseSecondSigned(bond, milestone, sig)`.
- Health check before activation and release:
  - **Native:** the project is reviewer-approved, bound to the account, and points at it.
  - **Watched:** the covenant reports healthy (a fresh Compliant observation).

### Adapters (two tiers)
| Tier | Source | Why fees can't be diverted |
|---|---|---|
| Native | `PumpLab`: charges fees through `account.collect`; account is immutable | No other payment path exists in the code |
| Watched | x402 API whose `payTo` is the account | Chainlink CRE checks `payTo` every 30 s; two adjacent violations default the bond and slash the stake |

Existing contracts can point their fee recipient at an account to build history (unclassified inflows)
but raise only as Native. The Locked tier (a FeeGuard holding an existing contract's ownership) was
removed: the guard only checks the getters it is configured with, so other admin roles, proxies or
withdraw paths could still divert fees, and making it safe needed Native-level review with weaker payer data.

### SliceCovenant
CRE receiver. Only `onReport` from the pinned forwarder, carrying an observation with the pinned
observer's EIP-712 signature. 30 s epochs, 90 s freshness, replay and equivocation protection.
Two adjacent Violations after activation trigger `markDefault`.

## 3. Off-chain
- **Observer:** fetches the x402 offer and signs Compliant, Violation or Unknown.
- **CRE workflow:** fetches independently, checks agreement with the observer, writes the report.
- **Agent:** x402 paid API; `payTo` = its SliceAccount.
- **Envio indexer:** accounts, bonds, payments, treasury funding edges, covenant checks, daily revenue
  (raw and verified). Payment classes:
  - `native`: the account's `Revenue` event from `collect`; payer proven by the pull.
  - `x402`: a USDC transfer into an account whose transaction emitted `AuthorizationUsed` for the sender
    (EIP-3009); payer signed it. Works before any bond.
  - `transfer`: any other transfer into an account; reason `unclassified_inflow`, excluded from verified.
- **Web:** markets, issuer evidence (history since day one, raw vs verified, payers, Nansen
  screening), bond workspace (deposit, live backing, redeem), passkey wallet.
- **Kuru:** claim/USDC market. **ERC-8004:** agent identity and default feedback.

## 4. Invariants (tested)
- Account: `USDC balance ≥ issuerCredit`; revenue booked = to bond + to issuer credit (exactly).
- Bond: `balance ≥ fundingEscrow + undrawn + pool + stakeHeld + stakeReturnCredit`;
  `pool + redeemed = revenue + principalRecovery + stakeRecovery`;
  `released + undrawn + principalRecovery = raise` after activation.
- Only the bound project can trigger `collect`; only the factory attaches bonds; one active bond per account.

## 5. Product vs demo
- Product: `contracts/src`, `packages/sdk` (`@slice/sdk`), `services`, `cre`, `indexer`, `apps/web`, `scripts/deploy.ts`.
- Demo: `demo/` (PumpLab, Oracle Agent on `@slice/sdk/x402`, setup/traffic/demo scripts). The demo uses only public protocol and SDK interfaces.
