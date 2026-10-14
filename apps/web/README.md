# Bondrail web

Next.js App Router frontend. Run installation from the workspace root, then `pnpm --filter @bondrail/web dev`, `typecheck`, or `build`.

The directory and charts use clearly labeled synthetic fixtures. They are never used as live balances, underwriting evidence or milestone signatures. Bond pages contain a separate configured-contract workspace; portfolio reads only actual connected-wallet balances. Network writes are restricted to 10143 and 31337. No fallback bond address maps one business to another.

Copy `.env.example` to local configuration. Public variables contain only network/address information. Set each actual deployed bond address separately, the settlement token and Factory. The issue wizard creates the SliceAccount, binds a Native project, and takes a committed policy hash. It supports exact-amount stake approval and simulated `createBond`, then waits for an actual receipt. Factory/contract permissions remain authoritative. Source creation and signed second-draw evidence are separate operator setup tasks.

Wallet actions simulate before requesting signatures. Failed/rejected/reverted transactions show errors; successful receipts are not described as Verified state-root checkpoints. Mainnet configuration disables writes. Claim amounts and contract values use six-decimal BigInt/decimal strings; display-only synthetic charts use numbers.

`/demo` includes public, nonsecret readiness flags plus a protected operator area. `DEMO_ACCESS_CODE` should be a unique strong secret. Login creates an expiring HMAC-signed HttpOnly, SameSite=Strict cookie; mutating routes require the same origin. Fixed restore/drift commands are proxied only to `AGENT_BASE_URL`, authenticate using server-only `AGENT_ADMIN_TOKEN`, read the current config revision, verify the test network, and use compare-and-set. The client cannot choose a recipient, service URL or arbitrary contract method. `DEMO_COMPLIANT_PAY_TO`/`NEXT_PUBLIC_AGENT_ROUTER_ADDRESS` and `DEMO_DIVERT_PAY_TO` configure the only destinations. An external access/rate-limit policy should protect a publicly hosted operator login.

No wallet, RPC or provider credentials are required to explore the synthetic preview. Sponsor support and a configured address are not represented as tested deployments or award qualification.
