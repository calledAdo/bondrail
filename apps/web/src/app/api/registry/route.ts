// Off-chain records the protocol has no field for, each verifiable by anyone:
//   profile  an EIP-712 profile signed by account.issuer() (checked on-chain), plus a domain check:
//            the website's /.well-known/slice.json must name the account
//   kuru     a Kuru market for a bond, proven by its MarketRegistered receipt (base asset = a Slice bond)
// Storage: Upstash Redis REST (KV_REST_API_URL / KV_REST_API_TOKEN), else in-memory for local dev.
import { NextResponse } from 'next/server';
import { createPublicClient, decodeEventLog, http, isAddress, parseAbi, recoverTypedDataAddress, type Address } from 'viem';
import { accountAbi, factoryAbi } from '@/lib/abi';
import { LIMITS, profileDomain, profileTypes, type KuruRecord, type ProfileRecord } from '@/lib/profile';

const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 10143);
const rpc = process.env.NEXT_PUBLIC_RPC_URL || (chainId === 31337 ? 'http://127.0.0.1:8545' : 'https://testnet-rpc.monad.xyz');
const factory = process.env.NEXT_PUBLIC_FACTORY_ADDRESS as Address | undefined;
const client = createPublicClient({ transport: http(rpc) });
const KURU_ROUTER = '0x7EFbE105Ca7415dE98F96622173458ac1c054630';
const marketRegistered = parseAbi([
  'event MarketRegistered(address baseAsset, address quoteAsset, address market, address vaultAddress, uint32 pricePrecision, uint96 sizePrecision, uint32 tickSize, uint96 minSize, uint96 maxSize, uint256 takerFeeBps, uint256 makerFeeBps, uint96 kuruAmmSpread)',
]);

// ---- storage
const memory = new Map<string, string>();
const kv = process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN
  ? { url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN }
  : null;
async function put(key: string, value: unknown) {
  const raw = JSON.stringify(value);
  if (!kv) return void memory.set(key, raw);
  await fetch(`${kv.url}/set/${encodeURIComponent(`slice:registry:${key}`)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${kv.token}` },
    body: raw,
  });
}
async function get<T>(key: string): Promise<T | null> {
  if (!kv) return memory.has(key) ? (JSON.parse(memory.get(key)!) as T) : null;
  const r = await fetch(`${kv.url}/get/${encodeURIComponent(`slice:registry:${key}`)}`, {
    headers: { Authorization: `Bearer ${kv.token}` },
    cache: 'no-store',
  });
  const j = (await r.json()) as { result: string | null };
  return j.result ? (JSON.parse(j.result) as T) : null;
}

async function domainNames(website: string, account: string) {
  try {
    const u = new URL(website);
    const local = chainId === 31337 && u.hostname === '127.0.0.1';
    // Public HTTPS hostnames only (no IP literals or localhost): the server fetches this URL.
    if (!local && (u.protocol !== 'https:' || u.port || /^[\d.]+$|^\[|localhost$/i.test(u.hostname))) return false;
    const r = await fetch(`${u.origin}/.well-known/slice.json`, { signal: AbortSignal.timeout(5000), cache: 'no-store' });
    const m = (await r.json()) as { account?: string };
    return typeof m.account === 'string' && m.account.toLowerCase() === account.toLowerCase();
  } catch {
    return false;
  }
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const list = (k: string) => (q.get(k) ?? '').split(',').filter((x): x is `0x${string}` => isAddress(x)).slice(0, 100);
  const profiles = Object.fromEntries(
    await Promise.all(list('accounts').map(async (a) => [a.toLowerCase(), await get<ProfileRecord>(`profile:${a.toLowerCase()}`)])),
  );
  const kuru = Object.fromEntries(
    await Promise.all(list('bonds').map(async (b) => [b.toLowerCase(), await get<KuruRecord>(`kuru:${b.toLowerCase()}`)])),
  );
  return NextResponse.json({ profiles, kuru }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (body.type === 'profile') {
      const p = body.profile;
      if (!isAddress(p?.account) || typeof body.signature !== 'string') throw new Error('Invalid profile');
      for (const [k, max] of Object.entries(LIMITS))
        if (typeof p[k] !== 'string' || p[k].length > max) throw new Error(`${k} must be text up to ${max} characters`);
      if (!p.name.trim()) throw new Error('A name is required');
      const message = { ...p, updatedAt: BigInt(p.updatedAt) };
      const signer = await recoverTypedDataAddress({
        domain: profileDomain(chainId),
        types: profileTypes,
        primaryType: 'Profile',
        message,
        signature: body.signature,
      });
      const issuer = (await client.readContract({ address: p.account, abi: accountAbi, functionName: 'issuer' })) as Address;
      if (signer.toLowerCase() !== issuer.toLowerCase()) throw new Error('The profile must be signed by the account issuer');
      const old = await get<ProfileRecord>(`profile:${p.account.toLowerCase()}`);
      if (old && BigInt(old.profile.updatedAt) >= message.updatedAt) throw new Error('A newer profile is already stored');
      const record: ProfileRecord = {
        profile: { ...p, updatedAt: String(p.updatedAt) },
        signature: body.signature,
        signer,
        domainVerified: p.website ? await domainNames(p.website, p.account) : false,
        checkedAt: Math.floor(Date.now() / 1000),
      };
      await put(`profile:${p.account.toLowerCase()}`, record);
      return NextResponse.json(record);
    }
    if (body.type === 'kuru') {
      const receipt = await client.getTransactionReceipt({ hash: body.tx });
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== KURU_ROUTER.toLowerCase()) continue;
        try {
          const e = decodeEventLog({ abi: marketRegistered, data: log.data, topics: log.topics });
          const bond = e.args.baseAsset;
          if (!factory || !(await client.readContract({ address: factory, abi: factoryAbi, functionName: 'isBond', args: [bond] })))
            throw new Error('The market base asset is not a Slice bond');
          const record: KuruRecord = { bond, market: e.args.market, vault: e.args.vaultAddress, tx: body.tx };
          await put(`kuru:${bond.toLowerCase()}`, record);
          return NextResponse.json(record);
        } catch (err) {
          if (err instanceof Error && err.message.includes('Slice bond')) throw err;
        }
      }
      throw new Error('No Kuru MarketRegistered event in this transaction');
    }
    throw new Error('Unknown record type');
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message.slice(0, 300) }, { status: 400 });
  }
}
