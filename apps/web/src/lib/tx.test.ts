import test from 'node:test';
import assert from 'node:assert/strict';
import type { PublicClient, TransactionReceipt } from 'viem';
import { receiptTimed } from './tx';

test('receiptTimed completes from the transaction hash if the wallet waiter stays pending', async () => {
  let reads = 0;
  const receipt = { status: 'success', transactionHash: `0x${'1'.repeat(64)}` } as TransactionReceipt;
  const provider = {
    waitForTransactionReceipt: () => new Promise(() => {}),
    getTransactionReceipt: async () => {
      reads++;
      if (reads === 1) throw new Error('receipt not indexed yet');
      return receipt;
    },
  } as unknown as PublicClient;
  const result = await receiptTimed(provider, receipt.transactionHash);
  assert.equal(result.receipt, receipt);
  assert.ok(result.ms >= 0);
  assert.equal(reads, 2);
});
