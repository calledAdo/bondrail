import type { Hash, PublicClient, TransactionReceipt } from 'viem';

/** Waits for a receipt, polling every 100 ms (viem's 4 s default would hide Monad's block time), and
 * measures broadcast → receipt as seen from this browser. */
export async function receiptTimed(client: PublicClient, hash: Hash): Promise<{ receipt: TransactionReceipt; ms: number }> {
  const start = performance.now();
  const receipt = await client.waitForTransactionReceipt({ hash, pollingInterval: 100 });
  return { receipt, ms: Math.round(performance.now() - start) };
}

/** "confirmed in 840 ms" — the measured time from broadcast to the on-chain receipt. */
export const confirmedIn = (ms: number) => `confirmed on Monad in ${ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`}`;
