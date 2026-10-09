import { createPublicClient, http, decodeEventLog, parseAbi, type Hex, type Address } from 'viem';
import type { DurableStore } from '@slice/observer/store';
import type { PaymentRecord } from './payment';
const abi = parseAbi([
  'event Transfer(address indexed from,address indexed to,uint256 value)',
  'event AuthorizationUsed(address indexed authorizer,bytes32 indexed nonce)',
]);
export function receiptProvesPayment(
  p: PaymentRecord,
  logs: readonly { address: Address; data: Hex; topics: readonly Hex[] }[],
): boolean {
  let transfer = false,
    authorization = false;
  for (const log of logs) {
    if (log.address.toLowerCase() !== p.requirements.asset.toLowerCase()) continue;
    try {
      const event = decodeEventLog({
        abi,
        data: log.data,
        topics: [...log.topics] as [Hex, ...Hex[]],
      });
      if (event.eventName === 'Transfer')
        transfer ||=
          event.args.from.toLowerCase() === p.payer &&
          event.args.to.toLowerCase() === p.requirements.payTo.toLowerCase() &&
          event.args.value === BigInt(p.requirements.amount);
      if (event.eventName === 'AuthorizationUsed')
        authorization ||=
          event.args.authorizer.toLowerCase() === p.payer && event.args.nonce.toLowerCase() === p.nonce;
    } catch {
      /* Unrelated token event. */
    }
  }
  return transfer && authorization;
}
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
  if (p.state !== 'settlement_pending' || !p.answer)
    throw new Error('Payment has no cached answer awaiting settlement');
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
