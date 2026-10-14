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

## Part B

- `tsup` emits ESM and `.d.ts` for ten entry points. Chosen over plain `tsc` because private observer/scoring helpers must be embedded in both JavaScript and declarations. viem and public x402 dependencies remain external.
- Workspace `exports` retain source paths; pnpm applies `publishConfig.exports` to the tarball, pointing all consumer exports at `dist/`. Use `npx -y pnpm@10.32.0 sdk:pack`; bare npm packing of the source directory does not apply this pnpm metadata override.
- Packed manifest: version 0.1.0, public access, MIT, Node >=20, viem ^2.54.2 peer; no private runtime dependencies, no workspace protocol anywhere in the manifest. Only x402 core/evm are runtime dependencies.
- Post-pack workspace tests: **127/127**; all **12 TypeScript configurations** passed again. Indexer codegen/tests and unchanged Solidity validation are recorded above.
- Installed the archive plus viem 2.54.2, TypeScript 5.9.3 and Node types into `/private/tmp/bondrail-sdk-consumer-k6b8n58s`, outside this repo. No workspace links. Plain Node ESM imports all ten entry points on both Node 26 and Node 20; pure credit/trigger/manifest calls also pass.
- Consumer `tsc --noEmit` with strict NodeNext resolution and library checking enabled passes for all entry points and every TypeScript README example. The examples were typechecked only; no transaction was sent.

### npm dry run file list

Command: `npm pack --dry-run --json ./packages/sdk/bondrail-sdk-0.1.0.tgz` after `sdk:pack`.
This inspects the actual pnpm-produced release archive without publishing it.

31 files; 39,094 bytes packed; 317,469 bytes unpacked.

```text
LICENSE
README.md
dist/abis.d.ts
dist/abis.js
dist/chunk-2FG2SMIN.js
dist/chunk-2MAOKF7R.js
dist/chunk-2MNHCEAH.js
dist/chunk-5SEWIYDC.js
dist/chunk-EVGBWROF.js
dist/chunk-FAGYPRRV.js
dist/chunk-JBULDEQC.js
dist/chunk-SPZV5H2Q.js
dist/client.d.ts
dist/client.js
dist/credit.d.ts
dist/credit.js
dist/data.d.ts
dist/data.js
dist/index.d.ts
dist/index.js
dist/permit.d.ts
dist/permit.js
dist/trigger.d.ts
dist/trigger.js
dist/x402-guard.d.ts
dist/x402-guard.js
dist/x402.d.ts
dist/x402.js
dist/yield.d.ts
dist/yield.js
package.json
```

### External project import output

```text
OK @bondrail/sdk (34 exports)
OK @bondrail/sdk/abis (7 exports)
OK @bondrail/sdk/client (4 exports)
OK @bondrail/sdk/permit (1 exports)
OK @bondrail/sdk/x402 (9 exports)
OK @bondrail/sdk/x402-guard (4 exports)
OK @bondrail/sdk/data (5 exports)
OK @bondrail/sdk/credit (7 exports)
OK @bondrail/sdk/yield (1 exports)
OK @bondrail/sdk/trigger (1 exports)
OK packed analytics, trigger parsing and manifest response
OK no workspace ranges, private runtime dependencies or legacy exports
```

### Remaining name audit

`git grep -n -i "slice"` was reviewed across tracked files. No legacy product identifiers remain in first-party executable source or SDK exports. Standard language/library names and preserved history are intentional. Counts below are matching lines (one line may contain several occurrences).

<!-- GREP_TABLE_START -->
| Remaining category | Matching lines | Files |
| --- | ---: | ---: |
| Naming history and migration notes | 15 | 5 |
| Ordinary English: portion of revenue/pool | 6 | 5 |
| Standard JavaScript Array/String methods | 47 | 30 |
| Third-party OpenZeppelin comments and terminal dependencies | 34 | 9 |
| Existing deployment hostnames | 10 | 8 |
| Required legacy manifest alias | 1 | 1 |
| Historical video files and local rendering tools | 50 | 17 |
| Existing credential and server paths | 18 | 12 |
| Historical plans, research, validation and evidence | 51 | 13 |
| Protected judged deployment JSON | 5 | 1 |
| This migration/validation report | 7 | 1 |
| **Total** | **244** | |
<!-- GREP_TABLE_END -->

The protected deployment, historical test output/research snapshots and old rendered-media paths retain their original names. Existing `~/.slice` credentials, `/opt/slice` server layout and real deployment hostnames remain usable. Neutral indexer entities were retained as noted above.
