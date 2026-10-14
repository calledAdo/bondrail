# Task 07 validation — 2026-10-14

Implemented on `next`, starting from `a765e02`. No push, deployment, live attestations or reputation transactions. Existing contract sources and `docs/deployments/*.json` remain unchanged. Registry, attester and web are explicitly not deployed.

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

On-chain data covers only recorded bonds, capped at 64; it does not guarantee complete factory history. Account counters include self-payments. Covenant default flags retain the existing observer/CRE trust. Total raised counts activated raises; paid-to-investors counts actual redemptions. See DESIGN.md for exact field definitions. Same-period corrections require newer issuedAt; signer rotation leaves existing accepted attestations valid until expiry.
