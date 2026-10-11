#!/usr/bin/env bash
# One covenant check: start the observer, run the Chainlink CRE workflow (simulate + broadcast to the
# covenant on Monad testnet), stop the observer. Run by slice-covenant.timer every 30 minutes.
#
# A violation is confirmed straight away: the covenant defaults a bond on violations in two adjacent
# 30 s epochs, so after a Violation this reports again in the next epoch. Detection is therefore up to
# one schedule interval (30 min) plus about a minute; the workflow is compiled once (on change) so a
# run fits inside an epoch.
set -euo pipefail
export PATH=/root/.cre/bin:/root/.bun/bin:/usr/local/bin:/usr/bin:/bin HOME=/root
WASM=/opt/slice/cre/slice-covenant/dist/workflow.wasm

cd /opt/slice/cre/slice-covenant
if [ ! -f "$WASM" ] || [ -n "$(find src config.json -newer "$WASM" -print -quit)" ]; then
  bun x cre-compile src/main.ts "$WASM" 2>&1 | grep -v jemalloc | tail -3
fi

cd /opt/slice/services/observer
set -a; . ./.env; set +a
tsx src/server.ts & OBS=$!
trap "kill $OBS 2>/dev/null || true" EXIT
for i in $(seq 30); do curl -sf http://127.0.0.1:8787/health >/dev/null && break; sleep 1; done

cd /opt/slice/cre
report() {
  cre workflow simulate slice-covenant --target testnet --non-interactive --trigger-index 0 --broadcast \
    --wasm "$WASM" 2>&1 | grep -v jemalloc
}
out=$(report); echo "$out"
# While violations continue, report once per epoch (up to 4 times): any two adjacent ones default.
for attempt in 1 2 3 4; do
  grep -q 'SLICE_RESULT=2' <<<"$out" || break
  epoch=$(grep -o 'SLICE_EPOCH=[0-9]*' <<<"$out" | cut -d= -f2)
  now=$(date +%s); next=$(( (epoch + 1) * 30 + 1 )); [ "$now" -lt "$next" ] && sleep $(( next - now ))
  echo "violation in epoch $epoch; confirming in the next epoch (attempt $attempt)"
  out=$(report); echo "$out"
done
