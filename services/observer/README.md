# Bondrail observer

The observer accepts only `POST /observe` with `{ "watchId": "registered-id", "epoch": 123 }` and `Authorization: Bearer <OBSERVER_API_TOKEN>`. It independently fetches the frozen URL. There is no endpoint for supplied verdicts, URLs, signatures or arbitrary calls. A process reads its registry once at startup. Freeze that registry before investors activate the corresponding bond; its canonical hash must equal the bond's registered policy hash.

The policy hash is `keccak256(UTF8(canonical(policy)))` using `@bondrail/observer/protocol`. Canonical JSON recursively sorts object keys, retains array order and string casing. Because this includes the bond address, predict the Factory's next created bond address before freezing/creating a watched issuance, then verify that actual address. Observation signatures separately bind chain, covenant, bond, policy and epoch.

The private key is a disclosed trusted observer authority. It must match the Covenant's immutable `observationSigner`. One durable record is written per chain/covenant/bond/policy/epoch. Concurrent callers wait for the same result; interrupted epochs are never signed twice. Do not delete old records or rotate signer identity under an active bond.

Malformed, unsupported, multiple, empty or unavailable offers are Unknown. A valid single v2 exact EIP-3009 offer that changes a committed payment field is a Violation. Only the onchain adjacent-epoch rule can default a bond. The observer itself never sends a transaction.

The observer has no chain RPC transport: it fetches unpaid HTTP offers and signs locally. Its parallel endpoint probes are not JSON-RPC calls. Chain-reading/writing services and operational scripts use `@bondrail/shared`'s paced transport; CRE's separate runtime/RPC configuration still needs its own shared-IP budget (see the [next runbook](../../docs/deployments/NEXT-RUNBOOK.md#rpc-budget-and-provider-configuration)).

HTTPS, fixed port, bounded headers/body/time, public DNS validation and a pinned connection address prevent local-network requests and DNS rebinding. Redirects are returned as Unknown without following them. The sole HTTP fixture exception is explicit local mode, chain31337 and `http://127.0.0.1:3001`. Registry headers allow only `accept` and `x-bondrail-probe`.

Run from this directory with Node environment loading, e.g. `node --env-file=.env --import tsx src/server.ts`. Copy `.env.example` and `registry.example.json`; all zero addresses/placeholders must be replaced. Production needs HTTPS ingress, `OBSERVER_HOST=0.0.0.0` behind that ingress, shared Redis REST and durable backups. Local files are single-host development storage; an interrupted filesystem CAS leaves a lock directory intentionally requiring operator inspection instead of unsafe lock stealing.

`GET /health` reveals signer address and watch count, never the private key or bearer token. Tests exercise protocol ambiguity, DNS ranges, cross-instance CAS, cached signatures and cross-chain replay rejection.
