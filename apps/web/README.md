# Bondrail web

Next.js App Router frontend. Run installation from the workspace root, then `pnpm --filter @bondrail/web dev`, `typecheck`, or `build`.

The directory and charts use clearly labeled synthetic fixtures. They are never used as live balances, underwriting evidence or milestone signatures. Bond pages contain a separate configured-contract workspace; portfolio reads only actual connected-wallet balances. Network writes are restricted to 10143 and 31337. No fallback bond address maps one business to another.

Copy `.env.example` to local configuration. Public variables contain only network/address information. Set each actual deployed bond address separately, the settlement token and Factory. The issue wizard creates the BondrailAccount, binds a Native project, and takes a committed policy hash. It supports exact-amount stake approval and simulated `createBond`, then waits for an actual receipt. Factory/contract permissions remain authoritative. Source creation and signed second-draw evidence are separate operator setup tasks.

Wallet actions simulate before requesting signatures. Failed/rejected/reverted transactions show errors; successful receipts are not described as Verified state-root checkpoints. Mainnet configuration disables writes. Claim amounts and contract values use six-decimal BigInt/decimal strings; display-only synthetic charts use numbers.

`/demo` includes public, nonsecret readiness flags plus a protected operator area. `DEMO_ACCESS_CODE` should be a unique strong secret. Login creates an expiring HMAC-signed HttpOnly, SameSite=Strict cookie; mutating routes require the same origin. Fixed restore/drift commands are proxied only to `AGENT_BASE_URL`, authenticate using server-only `AGENT_ADMIN_TOKEN`, read the current config revision, verify the test network, and use compare-and-set. The client cannot choose a recipient, service URL or arbitrary contract method. `DEMO_COMPLIANT_PAY_TO`/`NEXT_PUBLIC_AGENT_ROUTER_ADDRESS` and `DEMO_DIVERT_PAY_TO` configure the only destinations. An external access/rate-limit policy should protect a publicly hosted operator login.

No wallet, RPC or provider credentials are required to explore the synthetic preview. Sponsor support and a configured address are not represented as tested deployments or award qualification.

## Credit vault — not yet deployed

`/vault`, linked from the app navigation, is read-only. Leave `NEXT_PUBLIC_VAULT_ADDRESS` blank until
a vault exists on the configured `NEXT_PUBLIC_CHAIN_ID`/RPC. No deployment address is supplied by this
change. A missing address shows “Not yet deployed” and unavailable balances, not synthetic holdings.

Once configured, it reads entry/exit NAV, entry/exit one-share prices, idle assets, unvested income,
per-bond claims/cost/realized backing/exit carrying value, trigger/default flags, limits, owner, curator
and pending curator change directly at one block, refreshing every
30 seconds. It needs no wallet or indexer. Read failures are explicit; failed refreshes label the last
successful block. No deposit, withdrawal or curator transactions are exposed. Design limits shown
before configuration are labeled as design values, not live readings.

Entry prices use `previewMint(one share)`; exit prices use `previewRedeem(one share)`. Deposits stay
open during Active/Closing phases. Prices exclude unvested income; exit prices also include impairment.
Holding values precede the vault-wide vesting deduction. Carrying at cost assumes healthy bonds keep
paying, and impairment follows rules rather than a market price.

Account credit profiles show separate **On-chain record**, **Repayment record**, **Attested**, and unsigned indexer-estimate sections. Set optional `NEXT_PUBLIC_CREDIT_REGISTRY_ADDRESS` after deploying the registry; it is currently not deployed. Registry reads work without indexer data and share one block through the SDK. Repayment coverage shows "Repayment record covers N of M bonds" from registry membership and the factory issuance counter, with a clear incomplete warning (including the 64-bond limit). The attested section exposes its original signer, expiry, input period and evidence hash. Rotated-out signers remain visible with "Signed by a previous attester — not valid"; current-signer assessments past expiry show "Expired".
