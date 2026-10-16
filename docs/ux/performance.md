# Bond page performance — Task 22c

Oracle Agent: `/bonds/0x66A9aAfad577A6319645F4E2E2daAad42a987343`, measured on 2026-10-16 at **375 × 812 CSS pixels**. The indexed summary now arrives in the HTML; terms, actions, account evidence and live sections enrich it independently.

## Results

| Build and origin | Cold: indexed summary | Warm reload: indexed summary | Cold: full terms sentence | Warm: full terms sentence |
|---|---:|---:|---:|---:|
| Before, deployed `bondrail.vercel.app` | 5.037 s | 2.512 s | 5.037 s | 2.512 s |
| Before, unchanged local production build | 4.736 s | 2.868 s | 4.736 s | 2.868 s |
| After, updated local production build | **0.883 s** | **0.029 s** | 3.154 s | 0.245 s |

The cold indexed summary meets the **<2.5 s** target in this run, an **81% reduction** against the same local serving setup. This milestone means visible bond phase, repayment/current cap and backing figures, initially identified by bond address. The full name, contractual sentence and actions arrive with terms; the table reports that later milestone separately. Unknown revenue projections stay omitted until account evidence arrives.

The first production observation reproduced the reported long delay: **20.927 s cold / 2.246 s warm**, with an aborted RPC and retry. A repeat baseline supplied the valid waterfall above. The first harness used Playwright's invalid start time for aborted requests; the final harness records request start/completion wall time. The first summary measurement itself used the DOM/animation-frame observer and was valid. Network variability remains material: the first implementation still took 2.694 s cold / 2.894 s warm in the browser's initial GraphQL request, leading to the server-rendered summary. [That intermediate measurement](performance/after-initial.json) is retained.

**The updated application has not been deployed.** After timings and captures use a local production build with live services. Production HTML/CDN/server latency must be measured after a separately authorized deployment; this report does not claim a changed production timing. Cold/warm samples are individual observations, not a percentile estimate or a mobile-network guarantee.

## Request counts and durations

The fixed **25-second observation window** includes progressive section reads and polling. Counts below are browser HTTP requests, including JSON-RPC batches; durations include connection setup, CORS and transfer. A separate server indexer lookup supplies the after summary. Its cold duration was **797 ms**, and the warm 30-second-cache lookup was **1 ms**. That warm lookup is not an additional upstream HTTP request.

| Run | Browser GraphQL: count; duration range | RPC: count; duration range | Profile registry: count; duration range |
|---|---|---|---|
| Production before, cold | 2; 407–984 ms | 12; 158–923 ms | 2; 369–387 ms |
| Production before, warm | 3 (one pending at cutoff); 306–744 ms completed | 12; 161–449 ms | 2; 366–453 ms |
| Local before, cold | 2; 362–1,235 ms | 12; 153–1,774 ms | 2; 612–869 ms |
| Local before, warm | 2; 319–367 ms | 12; 164–989 ms | 2; 576–580 ms |
| Local after, cold | 2; 2,123–2,124 ms, plus server lookup above | 7; 167–3,197 ms | 1; 2,643 ms |
| Local after, warm | 2; 339 ms, plus cached server lookup above | 7; 160–6,582 ms | 1; 647 ms |

All individual start times, durations and decoded contract methods are in the [request waterfalls](performance/waterfalls.md). Raw requests, GraphQL variables, JSON-RPC payloads, browser resource timings, visible text and errors are retained in [deployed before](performance/before-production.json), [local before](performance/before-local.json) and [local after](performance/after.json).

Before rendering the old summary, the browser waited for a full-protocol GraphQL query, profiles for all three accounts/bonds, token metadata, both Native projects' approval reads and every bond's terms/backing/health. After rendering the new summary, slow profile and RPC responses can continue independently. The 3.197 s / 6.582 s `darkFor` refreshes in the final runs did not hide the summary.

## Loading and caching

- The route's first query filters `Bond.id` and `Issuer.activeBond` by the requested address. Active bonds can display their denomination in the initial HTML. Historical bonds resolve their own account next; unsupported assets wait for real metadata. Only the configured deployment's documented six-decimal USD token uses known metadata.
- Client queries filter account evidence (`Issuer`, `DailyRevenue`, `PayerTotal`), that account's bonds, and that bond's covenant checks. No bond or account route calls the full-protocol hook. A failed account evidence query leaves known terms visible and explicitly omits revenue projections.
- The indexer does not expose immutable terms/name/symbol. One aggregate reads those fields and preserves the SDK's legacy 13-word terms decoder. A separate multicall reads lifecycle/source details. Source health, credit and vault membership enrich their own sections. Pool, total supply, effective cap, policy hash and repayment come from the indexer; backing uses the contract's integer rounding at fixed 1e6 precision.
- React Query keys include chain/address (and indexer identity for indexed snapshots), normalize address case, and share metadata, profiles, asset metadata, account evidence, credit and vault membership across routes. Indexed/live reads stay fresh for 30 seconds, source darkness for 15 seconds, profiles for 60 seconds, and immutable metadata for the query-cache lifetime. The list query seeds detail/account caches. The server's initial snapshot has a 30-second cache.
- Markets retain one list query. RPC only supplies absent immutable metadata and live source eligibility, coalesced through multicall/JSON-RPC batching. It no longer reads each bond's backing, phase, pool, supply, effective cap or policy hash from RPC. Account bond lists show indexed identifiers/current caps without waiting for each bond's terms.

## Copy and action corrections

Oracle Agent's sentence now reads: “...until up to $2.40 has been repaid (currently up to $1.20, rising as more capital is released) or Oct 24, 2026.” The headline explicitly labels **Repaid $0.0775 of $1.20 (current cap)**. A genuine zero current cap remains zero; it is never replaced with the full cap. Sentence tests cover the phases and full/current/zero caps.

The deployed vault exposes `holdings()`, not `isHolding()`. The primary vault link requires positive membership in those tracked holdings. Missing, empty or failed reads do not advertise it. Oracle Agent is not held, so it shows **“Hold to earn; redeem after settlement”** with no primary action. The calculator's speculative vault link was removed. Funding, market purchases, settlement and refund actions retain their phase rules.

## Validation and captures

`pnpm check:all` passed on the final source: **149 Solidity tests, 210 workspace tests (32 web), 17 script tests, 9 indexer tests**, all **10 SDK exports**, the **2-test external contract consumer**, and both production app builds. [Validation and source hashes](performance/validation.json) identify the checked files. The unchanged baseline's 71 web source files were byte-identical to starting commit `ad7df6b`.

Earlier attempts found a missing `forge` PATH entry, a stale generated demo route, and one npm `ETIMEDOUT` fetching `viem`. Foundry's installed bin directory was added to the process PATH, generated output was moved aside, and the complete check was rerun successfully. No dependency or remote configuration changed.

**Seven browser regression groups passed**, with no browser errors. Markets made **one GraphQL request and two RPC batches** for all three bonds; decoded methods contain only terms/name/symbol and deposit eligibility. Browser regression results: [verification](performance/verification.json). Live page/layout and market request checks: [capture results](performance/live-captures.json). They cover stalled/failed RPC, failed account evidence, positive/negative/unknown vault membership, actual scoped GraphQL variables, and bond → account → bond navigation. The fresh account uses two filtered queries. Within the freshness window, navigation reuses bond metadata, profile and credit reads; only the account's bond-list query is new.

| Capture | 375 px | 1280 px |
|---|---|---|
| Production before, Oracle Agent | [Cold](performance/before-production-cold-375.png) / [warm](performance/before-production-warm-375.png) | — |
| Updated UI, live Oracle Agent data | [Mobile](performance/live-agent-375.png) | [Desktop](performance/live-agent-1280.png) |
| Updated UI, live PumpLab data | [Mobile](performance/live-pumplab-375.png) | [Desktop](performance/live-pumplab-1280.png) |
| Updated UI, live CurveLab data | [Mobile](performance/live-curvelab-375.png) | [Desktop](performance/live-curvelab-1280.png) |
| Indexed content while RPC/registry are held | [Mobile](performance/indexed-before-rpc-375.png) | — |
| Updated markets, live data | [Mobile](performance/markets-375.png) | — |

## Reproduction

Use the repository toolchain with Node and Foundry on PATH. Build with the public deployment settings in `apps/web/.env.example` (no production secrets required):

```sh
set -a
source apps/web/.env.example
set +a
pnpm check:all
pnpm --filter @bondrail/web start --port 3213
```

In a second terminal, `node docs/ux/performance/preview-proxy.mjs` serves port 3215. It proxies the application to port 3213 and **GET-only** profile-registry reads to the public production registry. It does not seed or mock responses. Before comparison used the identical proxy at 3216 pointing to the unchanged local build at 3214. Both browser contexts use Chrome headless, no artificial throttle, no wallet, and the same host/network. Timed runs are sequential. Warm reload retains HTTP/server caches but resets the in-memory React Query client; navigation reuse is tested separately.

```sh
PERF_BASE=http://127.0.0.1:3215 PERF_LABEL=after node docs/ux/performance/measure.mjs
PERF_BASE=http://127.0.0.1:3215 node --import tsx docs/ux/performance/verify.mjs
PERF_BASE=http://127.0.0.1:3215 node --import tsx docs/ux/performance/capture-live.mjs
node --import tsx docs/ux/performance/analyze.mjs
```

The verifier alone injects explicit delay/failure/holding scenarios; timing and live captures use real responses. No push, tags, publish, deployment, remote settings changes, signing or transactions were performed.
