// Buyer-side protection for x402 payments to Slice businesses.
//
// A Watched business decides its x402 `payTo` in an HTTP response, so it could show the monitor its
// SliceAccount and show paying customers another wallet. A guarded client checks every offer itself,
// before anything is signed: each payment option must pay the account the business published in
// `https://<its host>/.well-known/slice.json` (optionally confirmed on-chain as a real SliceAccount).
// A mismatch throws instead of paying.
//
// The manifest is the business's own claim, so it is only a discovery aid. A buyer paying a financed
// business should also `pin` what it expects from a source the business doesn't control (the bond's
// `account()` on-chain, see `pinFromBond`): then a changed manifest pointing at another account, even
// another real SliceAccount, is refused too.
//
//   import { wrapFetchWithPayment } from '@x402/fetch';
//   const pay = wrapFetchWithPayment(sliceGuard(fetch, { verifyAccount: isSliceAccount(publicClient, factory) }), x402);
//   await pay('https://agent.example/api/oracle?question=hi');
import type { Address, PublicClient } from 'viem';
import { address, decodeBase64Json, isRecord, type SliceManifest } from '@slice/observer/protocol';
import { sliceBondAbi, sliceFactoryAbi } from './abis';

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
  /** Per origin (`https://host`), what the buyer expects independently of the business's responses. */
  pin?: Record<string, Pin>;
}

export interface Pin {
  /** The SliceAccount every option must pay (e.g. the bond's `account()`). */
  account: Address;
  /** Chain id the offers must be on. */
  chainId?: number;
  /** Token the offers must charge in (the account's asset). */
  asset?: Address;
}

/** A `Pin` read on-chain from the bond being financed: its account, that account's asset and the chain. */
export async function pinFromBond(publicClient: PublicClient, bond: Address): Promise<Pin> {
  const account = (await publicClient.readContract({ address: bond, abi: sliceBondAbi, functionName: 'account' })) as Address;
  const asset = (await publicClient.readContract({ address: bond, abi: sliceBondAbi, functionName: 'asset' })) as Address;
  return { account, asset, chainId: await publicClient.getChainId() };
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
    // An offer from a redirect target is not the host the buyer chose (or pinned).
    if (response.redirected && new URL(response.url).origin !== url.origin)
      throw new SliceGuardError(`${url.origin} redirected the payment offer to ${new URL(response.url).origin}; refusing to pay`);
    const pin = o.pin?.[url.origin];
    const manifest = await manifestFor(url.origin);
    if (pin && manifest && manifest.account.toLowerCase() !== pin.account.toLowerCase())
      throw new SliceGuardError(
        `${url.origin} now publishes ${manifest.account}, not the pinned account ${pin.account}; refusing to pay`,
        undefined,
        pin.account,
      );
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
      if (pin?.chainId !== undefined && isRecord(a) && a.network !== `eip155:${pin.chainId}`)
        throw new SliceGuardError(`Offer is on ${String(a.network)}, not the pinned chain ${pin.chainId}`, payTo, pin.account);
      if (pin?.asset && (!isRecord(a) || typeof a.asset !== 'string' || a.asset.toLowerCase() !== pin.asset.toLowerCase()))
        throw new SliceGuardError(`Offer charges ${String(isRecord(a) ? a.asset : undefined)}, not the pinned asset ${pin.asset}`, payTo, pin.account);
    }
    return response;
  }) as typeof fetch;
}
