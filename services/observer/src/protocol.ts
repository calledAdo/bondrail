import { keccak256, stringToHex, encodeAbiParameters, type Address, type Hex } from 'viem';

export const PARSER_VERSION = 'slice-x402-v2-exact-eip3009/1';
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
export interface WatchPolicy {
  id: string;
  chainId: 10143 | 31337;
  chainSelector: string;
  covenant: Address;
  bond: Address;
  url: string;
  method: 'GET';
  headers: Record<string, string>;
  network: string;
  asset: Address;
  expectedPayTo: Address;
  amount: string;
  maxTimeoutSeconds: number;
  parserVersion: typeof PARSER_VERSION;
  epochSeconds: 30;
  freshnessSeconds: 90;
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
export function parseOffer(status: number, paymentRequired: string | undefined, p: WatchPolicy): ParsedOffer {
  const unknown = (reason: string): ParsedOffer => ({
    result: 0,
    observedPayTo: ZERO_ADDRESS,
    offerHash: ZERO_HASH,
    reason,
  });
  if (status !== 402 || !paymentRequired) return unknown('unavailable');
  try {
    const doc = decodeBase64Json(paymentRequired);
    if (
      !isRecord(doc) ||
      doc.x402Version !== 2 ||
      !isRecord(doc.resource) ||
      typeof doc.resource.url !== 'string' ||
      !Array.isArray(doc.accepts) ||
      doc.accepts.length !== 1
    )
      return unknown('ambiguous_or_malformed');
    const a = doc.accepts[0];
    if (
      !isRecord(a) ||
      a.scheme !== 'exact' ||
      typeof a.network !== 'string' ||
      !/^eip155:[1-9][0-9]*$/.test(a.network) ||
      !address(a.asset) ||
      !address(a.payTo) ||
      typeof a.amount !== 'string' ||
      !/^(0|[1-9][0-9]*)$/.test(a.amount) ||
      BigInt(a.amount) <= 0n ||
      !Number.isSafeInteger(a.maxTimeoutSeconds) ||
      Number(a.maxTimeoutSeconds) <= 0 ||
      !isRecord(a.extra) ||
      a.extra.assetTransferMethod !== 'eip3009' ||
      (a.extra.paymentFlow !== undefined && a.extra.paymentFlow !== 'authorization')
    )
      return unknown('unsupported_or_malformed');
    // Hash all offer fields (including unknown extras), excluding volatile transport headers and top-level errors.
    const offerHash = digest({
      resource: doc.resource,
      accepts: [a],
      extensions: doc.extensions ?? {},
    });
    const match =
      doc.resource.url === p.url &&
      a.network === p.network &&
      a.asset.toLowerCase() === p.asset.toLowerCase() &&
      a.payTo.toLowerCase() === p.expectedPayTo.toLowerCase() &&
      a.amount === p.amount &&
      a.maxTimeoutSeconds === p.maxTimeoutSeconds;
    return {
      result: match ? 1 : 2,
      observedPayTo: a.payTo,
      offerHash,
      reason: match ? 'compliant' : 'payment_policy_changed',
    };
  } catch {
    return unknown('malformed');
  }
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
