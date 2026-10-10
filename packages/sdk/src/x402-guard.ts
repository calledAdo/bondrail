// Buyer-side protection for x402 payments to Slice businesses.
//
// A Watched business decides its x402 `payTo` in an HTTP response, so it could show the monitor its
// SliceAccount and show paying customers another wallet. A guarded client checks every offer itself,
// before anything is signed: each payment option must pay the account the business published in
// `https://<its host>/.well-known/slice.json` (optionally confirmed on-chain as a real SliceAccount).
// A mismatch throws instead of paying.
//
//   import { wrapFetchWithPayment } from '@x402/fetch';
//   const pay = wrapFetchWithPayment(sliceGuard(fetch, { verifyAccount: isSliceAccount(publicClient, factory) }), x402);
//   await pay('https://agent.example/api/oracle?question=hi');
import type { Address, PublicClient } from 'viem';
import { address, decodeBase64Json, isRecord, type SliceManifest } from '@slice/observer/protocol';
import { sliceFactoryAbi } from './abis';

export class SliceGuardError extends Error {
  constructor(
    message: string,
    readonly offeredPayTo?: string,
    readonly account?: string,
  ) {
    super(message);
    this.name = 'SliceGuardError';
  }
}

export interface GuardOptions {
  /** Confirm the manifest's account on-chain (see `isSliceAccount`). */
  verifyAccount?: (account: Address) => Promise<boolean>;
  /** Pay hosts without a manifest anyway (default false: unknown hosts are refused). */
  allowUnlisted?: boolean;
  /** Manifest cache lifetime per origin (default 60 s). */
  cacheSeconds?: number;
}

/** `verifyAccount` that asks the SliceFactory whether the address is one of its accounts. */
export function isSliceAccount(publicClient: PublicClient, factory: Address) {
  return (account: Address) =>
    publicClient.readContract({ address: factory, abi: sliceFactoryAbi, functionName: 'isAccount', args: [account] });
}

/** Wraps `fetch` so that every 402 offer is checked against the host's Slice manifest before payment. */
export function sliceGuard(base: typeof fetch, o: GuardOptions = {}): typeof fetch {
  const cache = new Map<string, { at: number; manifest: SliceManifest | null }>();
  const ttl = (o.cacheSeconds ?? 60) * 1000;

  async function manifestFor(origin: string): Promise<SliceManifest | null> {
    const hit = cache.get(origin);
    if (hit && Date.now() - hit.at < ttl) return hit.manifest;
    let manifest: SliceManifest | null = null;
    try {
      const r = await base(`${origin}/.well-known/slice.json`, { headers: { accept: 'application/json' } });
      const m: unknown = r.ok ? await r.json() : null;
      if (isRecord(m) && m.version === 1 && address(m.account) && Array.isArray(m.endpoints))
        manifest = m as unknown as SliceManifest;
    } catch {}
    if (manifest && o.verifyAccount && !(await o.verifyAccount(manifest.account))) manifest = null;
    cache.set(origin, { at: Date.now(), manifest });
    return manifest;
  }

  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await base(input, init);
    const header = response.status === 402 ? response.headers.get('PAYMENT-REQUIRED') : null;
    if (!header) return response;
    const url = new URL(input instanceof Request ? input.url : String(input));
    const manifest = await manifestFor(url.origin);
    if (!manifest) {
      if (o.allowUnlisted) return response;
      throw new SliceGuardError(`${url.origin} publishes no valid Slice manifest; refusing to pay`);
    }
    let accepts: unknown[] = [];
    try {
      const doc = decodeBase64Json(header);
      if (isRecord(doc) && Array.isArray(doc.accepts)) accepts = doc.accepts;
    } catch {}
    if (accepts.length === 0) throw new SliceGuardError('Unreadable payment offer; refusing to pay');
    for (const a of accepts) {
      const payTo = isRecord(a) ? a.payTo : undefined;
      if (typeof payTo !== 'string' || payTo.toLowerCase() !== manifest.account.toLowerCase())
        throw new SliceGuardError(
          `Offer pays ${String(payTo)}, not the account ${manifest.account} that ${url.origin} published`,
          String(payTo),
          manifest.account,
        );
      if (isRecord(a) && a.network !== `eip155:${manifest.chainId}`)
        throw new SliceGuardError(`Offer is on ${String(a.network)}, not the manifest's chain`, payTo, manifest.account);
    }
    return response;
  }) as typeof fetch;
}
