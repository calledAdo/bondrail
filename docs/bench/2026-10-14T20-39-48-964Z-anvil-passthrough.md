# Payment load: anvil, passthrough

Script validation only. Anvil does not execute transactions in parallel.

Status: complete.

20 wallets × 5 payments per arm; 1 untimed warmups per wallet per arm. Order: shared-first. Receipt polling: 100 ms.

| Arm | Success / sent | Wall ms | Broadcast ms | Latency p50 / p95 ms | Txs / block | Block range | Gas p50 |
|---|---:|---:|---:|---:|---:|---|---:|
| shared | 100 / 100 | 984.42 | 22.93 | 971.98 / 977.92 | 100.00 | 97–97 | 119380 |
| separate | 100 / 100 | 994.21 | 19.14 | 982.31 / 987.35 | 100.00 | 98–98 | 119380 |

Raw data: [JSON](./2026-10-14T20-39-48-964Z-anvil-passthrough.json). Failed or incomplete arms invalidate comparison.
