// Gas drip for new passkey accounts: sends a little testnet MON so the first transaction needs no
// faucet. It only ever sends, only to accounts below the threshold, at most once per address per 6 h.
import { NextResponse } from 'next/server';
import { createPublicClient, createWalletClient, http, isAddress, parseEther, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { chain } from '@/lib/wallet';

const AMOUNT = parseEther(process.env.DRIP_AMOUNT ?? '0.3');
const THRESHOLD = parseEther('0.1');
const recent = new Map<string, number>(); // per server instance

export async function POST(req: Request) {
  const { address } = await req.json().catch(() => ({}));
  if (!isAddress(address)) return NextResponse.json({ error: 'bad address' }, { status: 400 });
  const key = process.env.DRIP_PRIVATE_KEY;
  if (!key || chain.id !== 10143) return NextResponse.json({ error: 'drip not configured' }, { status: 503 });
  const last = recent.get(address.toLowerCase()) ?? 0;
  if (Date.now() - last < 6 * 3600_000) return NextResponse.json({ skipped: 'recently dripped' });
  const rpc = process.env.NEXT_PUBLIC_RPC_URL || undefined;
  const pub = createPublicClient({ chain, transport: http(rpc) });
  if ((await pub.getBalance({ address })) >= THRESHOLD) return NextResponse.json({ skipped: 'has gas' });
  recent.set(address.toLowerCase(), Date.now());
  const from = privateKeyToAccount(key as Hex);
  const hash = await createWalletClient({ account: from, chain, transport: http(rpc) }).sendTransaction({
    to: address,
    value: AMOUNT,
    gas: 21_000n,
  });
  await pub.waitForTransactionReceipt({ hash });
  return NextResponse.json({ hash });
}
