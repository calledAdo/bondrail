# Slice implementation

Read docs/SPEC.md first. User authorized implementation. Testnet first; no real-money/mainnet transactions. Keep provider credentials server-side, never print secrets. Generated preview fixtures must be visibly labeled and cannot simulate a successful chain transaction.

One owner per workstream: contracts agent owns contracts/; services agent owns apps/agent/, services/observer/, services/worker/, cre/; frontend agent owns apps/web/; lead owns root files, packages/, indexer/, scripts/, docs/. Coordinate ABI changes centrally. Agents may write their own package.json; only lead installs workspace dependencies or changes pnpm-lock.yaml.

Use robust accounting and meaningful failure/invariant tests. Do not drop signed-report authentication, staged escrow recovery, post-close evidence window, or honest data/network labeling. Preserve synthetic demo labels. No privileged arbitrary URL fetch/sign/call endpoints.
