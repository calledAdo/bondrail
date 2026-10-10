#!/usr/bin/env bash
# One covenant report: start the observer, run the Chainlink CRE workflow (simulate + broadcast to the
# covenant on Monad testnet), stop the observer. Run by slice-covenant.timer every 45 minutes.
set -euo pipefail
export PATH=/root/.cre/bin:/root/.bun/bin:/usr/local/bin:/usr/bin:/bin HOME=/root
cd /opt/slice/services/observer
set -a; . ./.env; set +a
tsx src/server.ts & OBS=$!
trap "kill $OBS 2>/dev/null || true" EXIT
for i in $(seq 30); do curl -sf http://127.0.0.1:8787/health >/dev/null && break; sleep 1; done
cd /opt/slice/cre
cre workflow simulate slice-covenant --target testnet --non-interactive --trigger-index 0 --broadcast 2>&1 | grep -v jemalloc
