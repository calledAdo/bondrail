# Task 08 — rename and SDK distribution

## Part A

Validated on `next`, before SDK packaging:

- `~/.foundry/bin/forge test --root contracts`: **147 passed**, 0 failed (8 suites; fuzz 256; invariant 128 runs / 8192 calls).
- `~/.foundry/bin/forge build --root contracts --sizes`: passed; all production contracts below size limits.
- `npx -y pnpm@10.32.0 -r test`: **127 passed**, 0 failed: scoring 12, observer 9, worker 3, SDK 37, web 4, demo agent 6, attester 15, facilitator 41.
- Indexer codegen and tests: passed; **9 tests**, 0 failed.
- `tsc --noEmit` (incremental disabled): **12/12 configurations** passed: web, demo agent, SDK, shared, scoring, observer, worker, facilitator, attester, CRE, indexer, scripts/bench.
- Six renamed core Solidity files compare exactly to the prior sources after name substitutions. No accounting/control-flow changes.
- Seven SDK ABIs regenerated from the renamed Foundry artifacts; no old-name exports.
- Canonical and legacy agent manifest routes reference the identical handler; invoking both returns identical HTTP 200 JSON.
- Indexer config regenerated from the unchanged judged deployment record, then codegen regenerated contract registrations. Neutral GraphQL entity names (Issuer, Bond, Payment, etc.) are unchanged; no Slice-prefixed entities remain.
- Root `abi` script now invokes the existing SDK generator (its former root script path did not exist).

### Signed domains

| Before | After | Signer / verifier |
| --- | --- | --- |
| `SliceFactory` v1 | `BondrailFactory` v1 | Factory milestone signatures and Solidity tests |
| `SliceCovenant` v1 | `BondrailCovenant` v1 | Covenant, observer, CRE shared domain helper and tests |
| `Slice Profile` v1 | `Bondrail Profile` v1 | Web profile signing and API verification; demo profile signers |

The attester/registry domain was already `BondrailCreditRegistry` v1 and remains so. Token permit/EIP-3009 domains still come from the token. Old signatures and policy hashes must be regenerated for fresh `next` deployments. New manifests/policies use `/.well-known/bondrail.json`; `/.well-known/slice.json` remains the explicit document alias. Operator environment variables now use `BONDRAIL_*`; credential directories and existing hostnames remain compatible.

`docs/deployments/10143.json` was not edited. No deployment, publication, push, or other branch change was performed.
