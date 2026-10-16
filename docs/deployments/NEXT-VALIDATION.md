# Task 09 validation — 2026-10-15

Executed on branch `next`, local anvil only. No pushes, public-chain transactions, operator key-directory reads, or remote service changes.

| Check | Result |
| --- | --- |
| `pnpm e2e:local` (pnpm 10.32.0 via npx on this machine) | PASS: all 10 checks, real facilitator and browser |
| `forge test --root contracts` | 147 passed |
| `pnpm test` | 128 passed across 8 suites/packages |
| Indexer tests, from `indexer/` | 9 passed |
| `node --test scripts/deployment-path.test.mjs` | 3 passed |
| `pnpm typecheck`, scripts, benchmark and indexer tsc | All 13 configurations passed |
| Named Envio generation into a separate output directory | Factory/covenant/registry/start block match local next manifest; original config/source unchanged |
| Web production build and browser | Markets (all three bonds), vault (trigger/NAV), registry (coverage/evidence); no page errors |
| Owner CRE reporter guard | Rejects local chain before any key read or RPC/broadcast |
| Preview facilitator facade | 42 facilitator tests include pinned upstream/route/body handling; no Vercel deployment performed |
| Live judged manifest | SHA-256 unchanged: `4492e96c5005077416b09fe98ad3380a69c6c6826f2c3c91855c89d0dd85ab84` |

The rehearsal retains `docs/deployments/31337-next.json`, `.data/e2e-local/result.json`, service/build logs, evidence JSON and three screenshots locally (ignored). It stops all services and removes temporary keys. Local keys were generated under a temporary directory, and the anvil deployer used its public test key. Browser evidence shows 2 USDC entry NAV, 1.750080 USDC exit NAV, 1.5 USDC idle and the triggered PumpLab holding.

Integration fixes found during rehearsal: import the used connectors from Wagmi core exports to avoid resolving unused Solana dependencies during the production build; run Next from `apps/web` so build-time source snippets resolve; scope build-time deployment docs and video key paths; retain demo roles when resuming the full deploy. Indexer tests require `indexer/` as their working directory. These checks were rerun successfully after correction.

The local adapter verifies the app/attester interface and settlement attribution; Envio's separate tests cover its handlers. Local deployer stands in for the CRE forwarder after a signed HTTP observation. Remote Vercel/Envio/systemd/CRE operation, faucet balances and live service health remain owner checks in [archived rollout runbook](archive/NEXT-RUNBOOK.md). The funding table totals 9.8 test USDC and 7.1 MON balance targets, plus deployment/ongoing gas (recommended reserves: 12 USDC, 20 MON).

## Successful rehearsal tail

```text
PASS Web production build from 31337-next; browser reads all bonds, vault NAV and attestation without page errors
PASS Judged deployment manifest unchanged; only isolated anvil used
┌─────────┬────────────────────┬──────────────────────────────────────────────┐
│ (index) │ contract           │ address                                      │
├─────────┼────────────────────┼──────────────────────────────────────────────┤
│ 0       │ 'USDC'             │ '0x5fbdb2315678afecb367f032d93f642f64180aa3' │
│ 1       │ 'factory'          │ '0x610178da211fef7d417bc0e6fed39f05609ad788' │
│ 2       │ 'covenant'         │ '0x8a791620dd6260079bf849dc5567adc3f2fdc318' │
│ 3       │ 'registry'         │ '0xa51c1fc2f0d1a1b8494ed1fe312d7c3a78ed91c0' │
│ 4       │ 'vault'            │ '0x0dcd1bf9a1b36ce34237eeafef220932846bcd82' │
│ 5       │ 'PumpLab'          │ '0x8df5074a2cc937eD240a3F152fB81724d9d90874' │
│ 6       │ 'PumpLab account'  │ '0x6F1216D1BFe15c98520CA1434FC1d9D57AC95321' │
│ 7       │ 'PumpLab bond'     │ '0xa0E2E37c8bA56cD19fe3BD70f8c9390C0e3Dd5d8' │
│ 8       │ 'Agent account'    │ '0x193198556d1DbF455Aa063050eC1Cb039E8acECf' │
│ 9       │ 'Agent bond'       │ '0x454b0a07000FAD1a4686c40428463cC353E3fE84' │
│ 10      │ 'CurveLab account' │ '0xCBd5431cC04031d089c90E7c83288183A6Fe545d' │
│ 11      │ 'CurveLab bond'    │ '0xbb55fe723929CcB45a12C03fc91EBeD5407C8a6A' │
└─────────┴────────────────────┴──────────────────────────────────────────────┘
┌─────────┬────────────────────────────────────────────────────────────────────────────────────────────────────────────────┬────────┐
│ (index) │ check                                                                                                          │ result │
├─────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼────────┤
│ 0       │ 'Full deployment, role bindings and reviewed template'                                                         │ 'PASS' │
│ 1       │ 'Overwrite refused; --force resumes identical contracts'                                                       │ 'PASS' │
│ 2       │ 'Native traffic and x402 HTTP payments through facilitator/account.settle; replay safe'                        │ 'PASS' │
│ 3       │ 'History warp, three recorded bonds, CurveLab open raise; vault allocates in Funding and NAV = 2 USDC'         │ 'PASS' │
│ 4       │ 'Watched HTTP observation/activation; x402 repayment 2500 + issuer 7500 in same transaction'                   │ 'PASS' │
│ 5       │ 'Low-revenue trigger fires; share 40%; exit NAV 1750080, entry NAV 2000000; withdrawals idle-capped'           │ 'PASS' │
│ 6       │ 'Demo and full deploy reruns retain accounts/bonds/allocation'                                                 │ 'PASS' │
│ 7       │ 'Local indexer serves all bonds and x402; real attester relays valid, complete profile with matching evidence' │ 'PASS' │
│ 8       │ 'Web production build from 31337-next; browser reads all bonds, vault NAV and attestation without page errors' │ 'PASS' │
│ 9       │ 'Judged deployment manifest unchanged; only isolated anvil used'                                               │ 'PASS' │
└─────────┴────────────────────────────────────────────────────────────────────────────────────────────────────────────────┴────────┘
E2E LOCAL PASS (10 checks). Logs: /Users/adokiye/Nervos_Development/slice-next/.data/e2e-local. Services stop automatically.
```
