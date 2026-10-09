# Slice v1 specification

Single source of truth for the build. Supersedes everything in `docs/archive/`.
Decided 9 October 2026 (user + Claude). Network: Monad testnet (10143); local anvil (31337) for tests.

## 1. Idea

A business's revenue flows through its **SliceAccount** from day one. The account records every payment
on-chain, with the real payer, and builds a credit history before the business ever asks for money.
When the business raises against that revenue, the account starts splitting a fixed share to a
**SliceBond**. When the bond ends, the account goes back to paying the business 100%.

## 2. Contracts

### SliceAccount (one per business, clone created by SliceFactory)
The business's revenue address and payment entrypoint. Replaces the earlier "router".

**Bound parties**
- `issuer`: the business owner; withdraws the business's share, binds the project once.
- `project`: the Native project contract allowed to call `collect` (zero for Locked and Watched). Bound once by the issuer.
- `factory`: attaches and detaches bonds.

**Two ways money arrives**
1. **Collected (Native).** The project calls `collect(payer, gross, fee)` or `collectWithPermit(...)`.
   - The account pulls `gross` USDC from `payer` (`transferFrom`; with EIP-2612 permit, no standing approval is needed).
   - It keeps `fee` and sends `gross − fee` to the project.
   - The payer is proven by the pull itself. The fee is split immediately; no keeper is needed.
2. **Received (Locked, Watched).** A plain USDC transfer to the account: a legacy launchpad's fee
   transfer, or an x402 settlement. Anyone calls `sweep()` to book unrecorded balance as revenue
   (payer attributed off-chain from the transfer).

**Modes**
- **Passthrough** (no active bond, or bond still Funding): 100% of revenue is credited to the issuer.
- **Credit** (active bond): `revenueBps` of revenue goes to the bond, capped at the bond's remaining
  revenue cap. A rounding carry (`splitRemainder`) means micro-payments never round investors to zero.
  The rest is credited to the issuer.
- When the bond closes (cap, maturity) or is cancelled, the account detaches it and returns to passthrough.

**Credit history (on-chain, from the first payment)**
- `cumulativeRevenue`, `paymentCount`, `collectedCount`, `uniquePayers` (collected payers only),
  `firstRevenueAt`, `lastRevenueAt`.
- `revenueByDay[day]`.
- Bonds snapshot `cumulativeRevenue` at activation; the on-chain milestone reads the difference.

**Business share**: pull credit (`issuerCredit`, `withdraw(to, amount)`). A reverting recipient can
never block payments or investors.

### SliceBond (one per issuance, clone)
Vault plus ERC-20 claim (6 decimals, name and symbol per bond).
- **Funding:** deposits mint claims 1:1 until `raiseAmount`; transfers are locked while Funding; cancel and refund after `fundingDeadline`.
- **Activation:** issuer (via factory), only when fully funded and the source is healthy.
  - Releases `firstReleaseBps` (2500 or 5000) to the issuer; the rest stays as undrawn principal.
  - Snapshots `account.cumulativeRevenue()`.
- **Second release**, inside `[secondReleaseNotBefore, secondReleaseDeadline)`, source healthy, no default. Mode is fixed in terms:
  - `Onchain`: `account.cumulativeRevenue() − snapshot ≥ minRevenue` and `now ≥ activation + minOperatingPeriod`. Trustless; counts any revenue, including wash, which still costs the issuer real money.
  - `Signed`: an EIP-712 milestone from the factory's disclosed `milestoneSigner` (wash-adjusted off-chain).
- **Undrawn principal** becomes investor recovery if the deadline passes, the bond defaults, or collection closes.
- **Revenue cap** scales with released principal: `effectiveCap = repayCap × released / raise`.
- **Redeem at any time after activation** for `tokens × pool / supply`. The last claim waits for Closed.
- **Default (Watched only):** stake slashed into the pool; undrawn principal goes to recovery.
- **Closing → Closed:** Watched bonds get a 120 s window for late evidence; Locked and Native close immediately.

### SliceFactory
- `createAccount()`; the issuer is `msg.sender`.
- `setNativeApproval(project, bool)`: the disclosed `reviewer` approves a Native project's code (it pays every fee through `collect`). History accrues before review; review is required to raise.
- `createGuard(account, target, recipientGetter, feeGetter, minFee, allowedSelectors)`: a generic FeeGuard for any owner-administered fee contract; the issuer then points the fee recipient at the account and transfers ownership to the guard.
- The factory never deploys projects: Native projects inherit `SliceEarner` and bind themselves (`account.bindProject`, issuer only, the project must point at the account).
- `createBond(account, terms, config, name, symbol)`.
- `activate`, `releaseSecond(bond)` (on-chain mode), `releaseSecondSigned(bond, milestone, sig)`.
- Health check before activation and release:
  - **Native:** the project is reviewer-approved, bound to the account, and points at it.
  - **Locked:** the guard is locked.
  - **Watched:** the covenant reports healthy.

### Adapters (three tiers)
| Tier | Source | Why fees can't be diverted |
|---|---|---|
| Native | `PumpLab`: charges fees through `account.collect`; account is immutable | No other payment path exists in the code |
| Locked | `PumpLabClassic`: ordinary owner-administered launchpad, owned by `FeeGuard` | The guard refuses recipient, rate, ownership and unknown calls; re-checks the lock after every call |
| Watched | x402 API whose `payTo` is the account | Chainlink CRE checks `payTo` every 30 s; two adjacent violations default the bond and slash the stake |

### SliceCovenant
CRE receiver. Only `onReport` from the pinned forwarder, carrying an observation with the pinned
observer's EIP-712 signature. 30 s epochs, 90 s freshness, replay and equivocation protection.
Two adjacent Violations after activation trigger `markDefault`.

## 3. Off-chain
- **Observer:** fetches the x402 offer and signs Compliant, Violation or Unknown.
- **CRE workflow:** fetches independently, checks agreement with the observer, writes the report.
- **Agent:** x402 paid API; `payTo` = its SliceAccount.
- **Envio indexer:** accounts, bonds, payments (Collected events: proven payer; USDC transfers into
  accounts: x402 payer = transfer `from`; classic launchpad Trade events: trader), treasury funding
  edges, covenant checks, daily revenue (raw and verified).
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
- Demo: `demo/` (PumpLab, PumpLabClassic, Oracle Agent on `@slice/sdk/x402`, setup/traffic/demo scripts). The demo uses only public protocol and SDK interfaces.
