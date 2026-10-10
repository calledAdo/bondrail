import { keccak256, stringToHex, encodeAbiParameters, type Address, type Hex } from 'viem';

export const PARSER_VERSION = 'slice-x402-v2-exact-eip3009/2';
export const observationTypes = {
  Observation: [
    { name: 'bond', type: 'address' },
    { name: 'policyHash', type: 'bytes32' },
    { name: 'epoch', type: 'uint64' },
    { name: 'observedAt', type: 'uint64' },
    { name: 'expiresAt', type: 'uint64' },
    { name: 'result', type: 'uint8' },
    { name: 'observedPayTo', type: 'address' },
    { name: 'offerHash', type: 'bytes32' },
    { name: 'evidenceHash', type: 'bytes32' },
  ],
} as const;
export const observationComponents = observationTypes.Observation;
/** One paid resource the bond covers: an unpaid GET to `url` must return a 402 offer. */
export interface PaidEndpoint {
  url: string;
  /** Price floor in atomic units: a higher price is fine, a lower one is a violation. */
  minAmount: string;
}
/**
 * What one Watched bond commits to, fixed at creation (its hash is the bond's policyHash). The business
 * publishes a manifest at `https://<its host>/.well-known/slice.json` listing its account and every paid
 * endpoint; the policy covers all of them, and each check reads the manifest and every endpoint.
 */
export interface WatchPolicy {
  id: string;
  chainId: 10143 | 31337;
  chainSelector: string;
  covenant: Address;
  bond: Address;
  manifestUrl: string;
  endpoints: PaidEndpoint[];
  method: 'GET';
  headers: Record<string, string>;
  network: string;
  asset: Address;
  expectedPayTo: Address;
  maxTimeoutSeconds: number;
  parserVersion: typeof PARSER_VERSION;
  epochSeconds: 30;
  freshnessSeconds: 90;
}
/** Served by the business at /.well-known/slice.json (also its domain proof for the marketplace). */
export interface SliceManifest {
  version: 1;
  chainId: number;
  account: Address;
  endpoints: string[];
}
export interface Observation {
  bond: Address;
  policyHash: Hex;
  epoch: string;
  observedAt: string;
  expiresAt: string;
  result: 0 | 1 | 2;
  observedPayTo: Address;
  offerHash: Hex;
  evidenceHash: Hex;
}
export interface SignedObservation {
  observation: Observation;
  signature: Hex;
  signer: Address;
}
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;
export const ZERO_HASH = `0x${'0'.repeat(64)}` as Hex;
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
    .join(',')}}`;
}
export function digest(value: unknown): Hex {
  return keccak256(stringToHex(canonical(value)));
}
export function policyHash(policy: WatchPolicy): Hex {
  return digest(policy);
}
export function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
export function address(v: unknown): v is Address {
  return typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v);
}
export function decodeBase64Json(encoded: string): unknown {
  if (
    encoded.length > 16384 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
  )
    throw new Error('invalid payment header');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let bits = 0,
    value = 0;
  const out: number[] = [];
  for (const c of encoded.replace(/=+$/, '')) {
    value = (value << 6) | alphabet.indexOf(c);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >> bits) & 255);
    }
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(out)));
}
export interface ParsedOffer {
  result: 0 | 1 | 2;
  observedPayTo: Address;
  offerHash: Hex;
  reason: string;
}
const unknown = (reason: string): ParsedOffer => ({
  result: 0,
  observedPayTo: ZERO_ADDRESS,
  offerHash: ZERO_HASH,
  reason,
});
const violation = (reason: string, observedPayTo: unknown, offerHash: Hex): ParsedOffer => ({
  result: 2,
  observedPayTo: address(observedPayTo) ? observedPayTo : ZERO_ADDRESS,
  offerHash,
  reason,
});

/**
 * Classifies one endpoint's unpaid response.
 *   Unknown   : no readable 402 offer (outage, error, malformed document). Never a default on its own;
 *               a long unbroken run of Unknowns is (see SliceCovenant.DARK_DEFAULT).
 *   Violation : any payment option a client could pick does not pay the account the committed way:
 *               another payTo, another network, asset or scheme, or a price below the floor.
 *   Compliant : every option pays the account, in the committed asset, at or above the floor.
 */
export function parseOffer(
  status: number,
  paymentRequired: string | undefined,
  p: WatchPolicy,
  endpoint: PaidEndpoint,
): ParsedOffer {
  if (status !== 402 || !paymentRequired) return unknown('unavailable');
  let doc: unknown;
  try {
    doc = decodeBase64Json(paymentRequired);
  } catch {
    return unknown('malformed');
  }
  if (
    !isRecord(doc) ||
    doc.x402Version !== 2 ||
    !isRecord(doc.resource) ||
    doc.resource.url !== endpoint.url ||
    !Array.isArray(doc.accepts) ||
    doc.accepts.length === 0 ||
    doc.accepts.length > 8
  )
    return unknown('malformed');
  // Hash all offer fields (including unknown extras), excluding volatile transport headers and top-level errors.
  const offerHash = digest({ resource: doc.resource, accepts: doc.accepts, extensions: doc.extensions ?? {} });
  for (const a of doc.accepts) {
    if (!isRecord(a)) return violation('unverifiable_option', undefined, offerHash);
    if (!address(a.payTo) || a.payTo.toLowerCase() !== p.expectedPayTo.toLowerCase())
      return violation('payto_changed', a.payTo, offerHash);
    if (
      a.scheme !== 'exact' ||
      a.network !== p.network ||
      !address(a.asset) ||
      a.asset.toLowerCase() !== p.asset.toLowerCase() ||
      !isRecord(a.extra) ||
      a.extra.assetTransferMethod !== 'eip3009' ||
      (a.extra.paymentFlow !== undefined && a.extra.paymentFlow !== 'authorization')
    )
      return violation('option_not_to_account', a.payTo, offerHash);
    if (typeof a.amount !== 'string' || !/^[1-9][0-9]*$/.test(a.amount) || BigInt(a.amount) < BigInt(endpoint.minAmount))
      return violation('price_below_floor', a.payTo, offerHash);
    if (!Number.isSafeInteger(a.maxTimeoutSeconds) || Number(a.maxTimeoutSeconds) <= 0)
      return violation('unverifiable_option', a.payTo, offerHash);
  }
  return { result: 1, observedPayTo: p.expectedPayTo, offerHash, reason: 'compliant' };
}

/** Classifies the manifest: it must still name the account and still list every covered endpoint. */
export function parseManifest(status: number, body: string | undefined, p: WatchPolicy): ParsedOffer {
  if (status !== 200 || !body) return unknown('manifest_unavailable');
  let m: unknown;
  try {
    m = JSON.parse(body);
  } catch {
    return unknown('manifest_malformed');
  }
  if (!isRecord(m) || m.version !== 1 || !Array.isArray(m.endpoints) || m.endpoints.length > 64)
    return unknown('manifest_malformed');
  const hash = digest(m);
  if (m.chainId !== p.chainId || !address(m.account) || m.account.toLowerCase() !== p.expectedPayTo.toLowerCase())
    return violation('manifest_account_changed', m.account, hash);
  const listed = new Set(m.endpoints.filter((e): e is string => typeof e === 'string'));
  if (p.endpoints.some((e) => !listed.has(e.url))) return violation('manifest_endpoint_withdrawn', m.account, hash);
  return { result: 1, observedPayTo: p.expectedPayTo, offerHash: hash, reason: 'compliant' };
}

/** One observation for the bond: any violation wins, then all-compliant, otherwise Unknown. */
export function combine(parts: ParsedOffer[]): ParsedOffer {
  const offerHash = digest(parts.map((x) => x.offerHash));
  const bad = parts.find((x) => x.result === 2);
  if (bad) return { ...bad, offerHash };
  if (parts.every((x) => x.result === 1))
    return { result: 1, observedPayTo: parts[0]!.observedPayTo, offerHash, reason: 'compliant' };
  return unknown(parts.find((x) => x.result === 0)!.reason);
}

export interface FetchedResponse {
  status: number;
  header?: string;
  body?: string;
}
/** Scheme and host of a URL, by pattern (the CRE WASM runtime has no URL global). */
export function originOf(url: string): string | undefined {
  return /^(https?:\/\/[^/?#@\s]+)/i.exec(url)?.[1]?.toLowerCase();
}

export const MAX_CHECKED_ENDPOINTS = 16;
/**
 * Everything a check fetches: the policy's endpoints (with their price floors), plus any other paid
 * endpoint the manifest now lists on the same origin. Those were added after issuance, so they have no
 * floor, but they must still pay the account. Undeclared endpoints cannot be seen by anyone.
 */
export function endpointsToCheck(p: WatchPolicy, manifest: FetchedResponse): PaidEndpoint[] {
  const out = [...p.endpoints];
  let listed: unknown;
  try {
    listed = manifest.status === 200 && manifest.body ? JSON.parse(manifest.body)?.endpoints : undefined;
  } catch {}
  if (!Array.isArray(listed)) return out;
  const origin = originOf(p.manifestUrl);
  for (const url of listed) {
    if (out.length >= MAX_CHECKED_ENDPOINTS) break;
    if (typeof url !== 'string' || url.length > 2048 || originOf(url) !== origin) continue;
    if (!out.some((e) => e.url === url)) out.push({ url, minAmount: '1' });
  }
  return out;
}

/** Classify a full check: the manifest, then each endpoint's response (same order as `endpoints`). */
export function classify(
  p: WatchPolicy,
  manifest: FetchedResponse,
  endpoints: PaidEndpoint[],
  offers: FetchedResponse[],
): ParsedOffer {
  return combine([
    parseManifest(manifest.status, manifest.body, p),
    ...endpoints.map((e, i) => parseOffer(offers[i]?.status ?? 0, offers[i]?.header, p, e)),
  ]);
}
export function typedObservation(o: Observation) {
  return {
    ...o,
    epoch: BigInt(o.epoch),
    observedAt: BigInt(o.observedAt),
    expiresAt: BigInt(o.expiresAt),
  };
}
export function observationDomain(p: WatchPolicy) {
  return {
    name: 'SliceCovenant',
    version: '1',
    chainId: p.chainId,
    verifyingContract: p.covenant,
  };
}
export function encodeObservationReport(s: SignedObservation): Hex {
  return encodeAbiParameters(
    [{ type: 'tuple', components: observationComponents }, { type: 'bytes' }],
    [typedObservation(s.observation), s.signature],
  );
}
