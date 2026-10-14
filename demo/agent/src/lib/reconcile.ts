import { createPublicClient, http, type Hex } from 'viem';
import type { DurableStore } from '@bondrail/observer/store';
import { receiptProvesPayment, type PaymentRecord } from '@bondrail/sdk/x402';
export { receiptProvesPayment };
export async function reconcile(
  store: DurableStore,
  key: string,
  transaction: Hex,
  rpcURL: string,
  chainId: number,
) {
  if (!/^payment:0x[0-9a-f]{64}$/.test(key) || !/^0x[0-9a-fA-F]{64}$/.test(transaction))
    throw new Error('Invalid reconciliation identifiers');
  const raw = await store.get(key);
  if (!raw) throw new Error('Unknown payment');
  const p = JSON.parse(raw) as PaymentRecord;
  if (p.state === 'complete') return { status: 'complete', transaction: p.settlement?.transaction };
  if (p.state !== 'settlement_pending' || p.result === undefined)
    throw new Error('Payment has no journaled result awaiting settlement');
  const client = createPublicClient({ transport: http(rpcURL) });
  if ((await client.getChainId()) !== chainId || p.requirements.network !== `eip155:${chainId}`)
    throw new Error('RPC chain mismatch');
  const receipt = await client.getTransactionReceipt({ hash: transaction });
  if (receipt.status !== 'success') throw new Error('Settlement transaction failed');
  const block = await client.getBlockNumber();
  if (block < receipt.blockNumber + 1n) throw new Error('Wait for one confirmation');
  if (!receiptProvesPayment(p, receipt.logs))
    throw new Error('Receipt does not prove this exact authorized payment');
  const settlement = {
    success: true,
    transaction,
    network: p.requirements.network,
    payer: p.payer,
  };
  if (!(await store.cas(key, raw, JSON.stringify({ ...p, state: 'complete', settlement }))))
    throw new Error('Reconciliation conflict');
  return { status: 'complete', transaction };
}
