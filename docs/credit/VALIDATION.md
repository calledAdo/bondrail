# Task 07 validation — 2026-10-14

Implemented on `next`, starting from `a765e02`. No push, deployment, live attestations or reputation transactions. Original Task 07 left existing contract sources and `docs/deployments/*.json` unchanged. Task 07b below adds the factory counter; deployment manifests remain unchanged. Registry, attester and web are explicitly not deployed.

## Contracts

`~/.foundry/bin/forge test --root contracts`: **144 passed**, 0 failed, 0 skipped (8 suites). The new 14 registry tests cover permissionless registration/events, non-bonds, duplicates, the 65th bond, account counters, mixed Funding/Active/cap/maturity/cancel/default records, Closing grace and overlapping default, real investor redemptions, signatures/domain/chain/time checks, stale corrections, nonce replay and attester timelock/replacement. New aggregate fuzz: 256 runs. Existing accounting invariant: 128 runs / 8,192 calls / zero reverts.

`forge build --root contracts --sizes` succeeded. Production sizes fit EIP-170/EIP-3860; changed Solidity files pass `forge fmt --check`.

| Contract | Runtime bytes | Initcode bytes |
| --- | ---: | ---: |
| BondrailCreditRegistry | 10,188 | 11,582 |
| BondrailVault | 12,671 | 14,224 |
| SliceAccount | 8,090 | 8,132 |
| SliceBond | 12,153 | 12,918 |
| SliceFactory | 12,285 | 13,734 |

## Offchain

- `npx -y pnpm@10.32.0 -r test`: **119/119** across scoring 12, observer 9, worker 3, SDK 36, web 4, demo agent 6, attester 8, facilitator 41.
- Indexer is a separate package, outside the root workspace: `npx -y pnpm@10.32.0 --dir indexer test`: **9/9**, including registry history/latest/signers, two registry namespaces and existing settlement attribution tests. Test-only discovery registers synthetic addresses; production has no wildcard registry listener.
- Web, SDK, attester and indexer `tsc --noEmit` passed. The ERC-8004 script also passes standalone strict TypeScript checking without execution. Envio codegen succeeded with BondRecorded, Attested and the new entities. Generated `.envio` types are ignored per existing repository convention.
- Seven SDK ABIs regenerated and verified against Foundry artifacts; typed attestation fields match the Solidity tuple. Evidence filename matches its content hash. SDK reader tests verify one-block reads and surfaced errors. Shared credit metrics prevent web/attester definition drift.
- Attester tests cover canonical ordering/hash mutation, fixture calculations, EIP-712 signature recovery/domain separation, exclusions/empty inputs, malformed inputs, changing indexer snapshots and pagination. Reproducible unsigned fixture dry-run wrote the sample under `evidence/`; no transaction was sent.
- Browser checks at 1440×1000 and 375×812 passed: undeployed state; independent registry sections without indexer; simulated populated record; original and rotated signer; evidence hash; 50% maturity repayment ratio; expired/missing attestation; RPC failure. No page errors or horizontal page overflow. Screenshots inspected. Populated checks intercepted RPC responses; they are not a deployed integration test.

## Limits readers must retain

Trust the attester for **attributedRevenue, excludedRevenue, distinctPayers, topPayerShareBps and creditLine**, including indexer coverage, classifications and policy inputs. Signature/time/nonce checks authenticate and bound the claim; evidenceHash commits to bytes, not truth or availability. No EAS deployment on Monad testnet was confirmed in the official contracts list.

On-chain repayment totals cover only recorded bonds, capped at 64. Task 07b adds factory-backed `bondsCreated`/`complete` coverage, including an incomplete warning beyond the cap. Account counters include self-payments. Covenant default flags retain the existing observer/CRE trust. Total raised counts activated raises; paid-to-investors counts actual redemptions. See DESIGN.md for exact field definitions. Same-period corrections require newer issuedAt; Task 07b makes stored assessments by a previous attester invalid on accepted rotation while preserving their payload and signer. The Task 07 counts and checks above are the historical baseline; see the Task 07b validation below for the corrections.


## Task 07b review corrections — 2026-10-14

Implemented from `199fc75` on `next`, with no push/deploy or live transactions. `SliceFactory` adds one counter increment per successful bond creation. Registry coverage now returns `bondsCreated` and `complete`; stored attestations require the current signer to remain valid. SDK/web/docs reflect both rules. Attester relay registers missing bonds before attesting, reconciling factory events and confirming receipts; it refuses incomplete coverage or accounts above 64 bonds.

| Check | Result |
| --- | --- |
| `forge test --root contracts` | **147 passed**, 0 failed/skipped, 8 suites; registry **17** (aggregate fuzz 256 runs); accounting invariant 128 runs / 8,192 calls / 0 reverts |
| `pnpm -r test` (cached pnpm 10.32.0) | **127 passed**, 0 failed: scoring 12, observer 9, worker 3, SDK 37, web 4, demo agent 6, attester 15, facilitator 41 |
| Separate `pnpm --dir indexer test` | **9 passed**, 0 failed |
| `tsc --noEmit` in web, SDK, indexer, attester | **4/4 passed** |
| Changed Solidity `forge fmt --check`; `git diff --check` | Passed |
| SDK generated ABIs | All seven match Foundry artifacts |

Regressions cover zero-of-zero coverage; incomplete until every bond is registered; renewed incompleteness on issuance; third-party registration after default; 64-of-65 remaining incomplete; successful, cancelled and failed issuance accounting; original payload/signer preserved after rotation; valid before acceptance, invalid after, valid with a fresh current-signer attestation. Relay tests verify paginated factory discovery, skipping recorded bonds, confirmations before `attest`, count mismatch, bond limit, reverted registration, concurrent issuance and a rotated-out service key.

Browser smoke with simulated RPC passed at 1440×1000 and 375×812. Checked coverage text/warnings at 1 of 2, 1 of 1 and 64 of 65; previous/current/expired/missing signer labels; retained signer and evidence; RPC failure. No page errors or horizontal page overflow; desktop/mobile screenshots inspected. This is a simulated UI test, not a deployed integration test.

Runtime/initcode sizes: SliceFactory **12,401 / 13,850** bytes; BondrailCreditRegistry **10,448 / 11,849** bytes, within deployment limits. The full workspace command needed local socket access for tsx after an initial sandbox EPERM; the successful run used the normal package scripts. No dependency or deployment configuration changes.

Coverage remains scoped to this account/factory and the read block. New issuance after the relay's final check may make it incomplete again. Accounts over 64 remain incomplete and cannot be attested by this service. These undeployed revisions require the new factory getter and regenerated registry ABI; historical deployments are unchanged.
