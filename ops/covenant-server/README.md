# Server: covenant reporter and maintenance worker

Two systemd timers on one small Linux server.

**Covenant reporter** (`bondrail-covenant.timer`, every 30 minutes): `report.sh` starts the observer, runs the
Chainlink CRE workflow (`cre workflow simulate --broadcast`) and stops. GitHub Actions can't do this
without a `CRE_API_KEY`, which needs CRE deploy access, so it runs on a small Linux server that keeps
its CRE login in `/root/.cre/cre.yaml`.

Layout on the server: `/opt/slice` holds `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`,
`tsconfig.base.json`, `services/observer` and `cre/` (with both `.env` files, mode 600). Install with
`pnpm install --frozen-lockfile --filter ./services/observer --filter ./cre/bondrail-covenant`, then copy
the unit files to `/etc/systemd/system` and `systemctl enable --now bondrail-covenant.timer`.

Logs: `journalctl -u bondrail-covenant.service`. If the CRE login expires, sign in again and recopy
`~/.cre/cre.yaml`.

**Maintenance worker** (`bondrail-worker.timer`, every 10 minutes): one cycle of
[`services/worker`](../../services/worker): it books x402 receipts (`sweep`), returns undrawn capital after the
second-release deadline, closes bonds at maturity and finalizes settlement. Its own key (`worker`, MON for gas
only), `.env` with `BONDRAIL_ENABLE_TESTNET_WRITES=1` and `WORKER_MAX_CYCLES=1`, and a `targets.json` of bonds.

**RPC:** Monad's public endpoint allows 15 requests/s per IP, which a shared server can exhaust. Both jobs use
`https://rpc-testnet.monadinfra.com` there (the worker's `BONDRAIL_RPC_URL`; `cre/project.yaml` on the server).
