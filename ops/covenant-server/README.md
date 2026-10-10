# Covenant reporter (server)

Runs the Watched bond's covenant report every 30 minutes: `report.sh` starts the observer, runs the
Chainlink CRE workflow (`cre workflow simulate --broadcast`) and stops. GitHub Actions can't do this
without a `CRE_API_KEY`, which needs CRE deploy access, so it runs on a small Linux server that keeps
its CRE login in `/root/.cre/cre.yaml`.

Layout on the server: `/opt/slice` holds `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`,
`tsconfig.base.json`, `services/observer` and `cre/` (with both `.env` files, mode 600). Install with
`pnpm install --frozen-lockfile --filter ./services/observer --filter ./cre/slice-covenant`, then copy
the unit files to `/etc/systemd/system` and `systemctl enable --now slice-covenant.timer`.

Logs: `journalctl -u slice-covenant.service`. If the CRE login expires, sign in again and recopy
`~/.cre/cre.yaml`.
