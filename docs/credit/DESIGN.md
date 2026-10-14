# Portable credit profiles

Status: **not deployed**. Registry scoped to one immutable SliceFactory and its chain. No existing account/bond state changes.

## EAS decision (checked 2026-10-14)

Searched the [official EAS contracts deployment list](https://github.com/ethereum-attestation-service/eas-contracts#deployments), its [deployment directories](https://api.github.com/repos/ethereum-attestation-service/eas-contracts/contents/deployments), and the [EAS contract-address docs](https://docs.attest.org/docs/quick--start/contract-addresses) for `Monad` and `10143`. No Monad testnet deployment is listed in the contracts repository. The docs routes returned a client-rendered shell rather than an independently readable deployment list. **An official deployment on chain 10143 is unconfirmed**, not proven absent. Do not use another chain's EAS address. Use BondrailCreditRegistry only; no EAS publication now.

The flat, ABI-encodable schema is `address account,uint256 chainId,uint64 periodStart,uint64 periodEnd,uint256 attributedRevenue,uint256 excludedRevenue,uint256 distinctPayers,uint16 topPayerShareBps,uint256 creditLine,bytes32 evidenceHash,uint64 issuedAt,uint64 expiresAt,uint256 nonce`. A later EAS adapter can register this schema and publish `abi.encode(attestation)` as data, account as recipient, expiresAt as expirationTime, with the signer explicitly preserved. EAS's own envelope/signature differs; this is schema compatibility, not interchangeable signatures.

## Trust per field

| Layer / fields | Meaning and trust |
| --- | --- |
| On-chain asset, issuer, project | Direct account getters; no credit attester. Project binding does not assert current reviewer approval. |
| On-chain tier | Native when project is bound; otherwise Watched when a bond is recorded, Unknown before that. Account classification, not a guarantee that every historical bond used that adapter; per-bond adapter is returned. |
| firstRevenueAt, historyAge (seconds) | Since first booked nonzero revenue; zero for no history. Time alone does not establish business quality. |
| cumulativeRevenue, cumulativeVolume, paymentCount, collectedCount, uniquePayers | Exact account counters, including self-payments and unclassified receipts. Unique payer addresses are not independent customers. Volume excludes plain transfers; zero-fee activity increases volume but not revenue counters. |
| Bond counts, amounts, close reason, repayment ratios | Current factory-created bond getters. Issued = recorded bonds, active = phase Active; Funding and Closing also disclosed. Fully repaid = collection closed by RevenueCap, including Closing; maturity closures expose collected / effectiveRevenueCap in basis points, excluding principal/stake recovery. Default is an overlapping flag, including cap-closed bonds, and reflects the existing covenant's observer/CRE trust. It is not a trustless judgment of economic default. |
| totalRaised | Sum of original raiseAmount for activated bonds (stable after redemptions). Funding/cancelled deposits are not successful raises. |
| totalRepaidToInvestors | Sum of totalRedeemed: actual paid redemptions, including recovered principal/stake. Collected revenue is separately exposed; unclaimed pool is not paid out. |
| Attested attributedRevenue, excludedRevenue, distinctPayers, topPayerShareBps | Trust the disclosed signer for indexer completeness, payer attribution, issuer funding links and exclusion policy. No proof of independent customers or absence of wash trading. |
| Attested creditLine | Trust that signer for the above inputs and policy; SDK default terms, advisory asset-base-unit amount, no promise of repayment. |
| evidenceHash, period, issuedAt, expiresAt, chainId, nonce | Signature authenticates the signer's assertion; hash binds canonical input JSON but proves neither truth nor availability. Contract enforces chain/domain, time bounds, freshness ordering and replay protection. |

`recordBond` is permissionless, unique, append-only and bounded at 64 per account. Profiles cover **recorded bonds only**: compare factory events before lending; neither omission nor histories beyond 64 are solved by this registry. Accounts must belong to the factory. No state-changing calls into existing contracts.

## Attestation and operations

EIP-712 domain: `BondrailCreditRegistry`, version `1`, chain ID and registry address. Nonces consumed per account forever, including across signer rotations. Newer periodEnd wins; equal periods require a strictly newer issuedAt so old corrections cannot overwrite newer ones. Valid means an attestation exists and block time is before expiresAt; disclose the original signer even after rotation. Owner proposes/replaces an attester with a fresh two-day delay, then accepts as in BondrailVault. Rotation does not revoke already accepted attestations; readers may reject an old signer themselves.

Attester defaults to dry-run; only explicit `--relay` sends a transaction. Inputs come from paginated indexer account/payer/daily aggregates using the web's definitions: attributed lifetime payer totals exclude any payer marked related; excluded totals sum related payers; distinct payers count remaining positive totals; top share is their maximum / attributed total (rounded up to bps). Credit line uses attributed daily revenue over the last seven UTC buckets including today, divided by min(7, max(1, history age in days)), matching the existing web. Input evidence records these aggregates, policy/default terms, period and account, chain and registry. The attester trusts that indexer snapshot; it must fail on truncation or malformed inputs. No Nansen testnet claims. Canonical JSON recursively sorts object keys, sorts input rows by stable IDs, represents amounts as decimal strings and has no insignificant whitespace. Store exactly those UTF-8 bytes under docs/credit/evidence/ in dry-run; hash with keccak256.

SDK reads both layers and current attester at one block. Web keeps indexer estimates distinct from registry sections, shows not-deployed status without a configured address, and exposes repayment rows, signer, expiry and evidence hash. Indexer stores registry-qualified BondRecorded and Attested history/latest rows; registry address is optional configuration, never a made-up deployment. ERC-8004 feedback stays an explicit script action and requires final Closed + cap reached + no default for positive feedback.
