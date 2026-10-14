// x402 payments into a SliceAccount: make any paid HTTP endpoint pay its SliceAccount, so its revenue
// builds on-chain history and, while a bond is active, pays investors automatically.
//
// Flow per request:
//   1. no payment header -> HTTP 402 with the exact USDC offer (payTo = the account)
//   2. payment header    -> decode, idempotency check, exact-terms check, facilitator verify
//   3. journal "processing" (compare-and-swap) -> run the paid work -> journal the result
//   4. facilitator settle (EIP-3009 transferWithAuthorization: payer -> account, facilitator pays gas)
//   5. journal "complete" -> 200 with the result and a PAYMENT-RESPONSE header
// Retries with the same signed authorization return the journaled result; one authorization can never
// buy two different requests or be charged twice.
import { HTTPFacilitatorClient, x402ResourceServer } from '@x402/core/server';
import type { PaymentPayload, PaymentRequirements, SettleResponse } from '@x402/core/types';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { address, canonical, decodeBase64Json, digest, isRecord, type SliceManifest } from '@bondrail/observer/protocol';
import type { DurableStore } from '@bondrail/observer/store';
import { decodeEventLog, parseAbi, parseSignature, type Account, type Address, type Chain, type Hex, type Transport, type WalletClient } from 'viem';
import { sliceAccountAbi } from './abis';

export type { DurableStore, SliceManifest };

/** EIP-3009 wire authorization; all integer fields are atomic-unit decimal strings. */
export interface TransferAuthorization {
  from: Address;
  to: Address;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: Hex;
}

/** Relay an exact x402 authorization through its account. Returns the submitted transaction hash. */
export async function settleThroughAccount(
  walletClient: WalletClient<Transport, Chain, Account>,
  account: Address,
  authorization: TransferAuthorization,
  signature: Hex,
): Promise<Hex> {
  if (authorization.to.toLowerCase() !== account.toLowerCase())
    throw new Error('Authorization recipient must be the SliceAccount');
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new Error('Expected a 65-byte EIP-3009 signature');
  const { r, s, yParity } = parseSignature(signature);
  return walletClient.writeContract({
    address: account,
    abi: sliceAccountAbi,
    functionName: 'settle',
    args: [authorization.from, BigInt(authorization.value), BigInt(authorization.validAfter),
      BigInt(authorization.validBefore), authorization.nonce, 27 + yParity, r, s],
  });
}

export interface PaymentRecord {
  state: 'processing' | 'work_failed' | 'settlement_pending' | 'complete';
  binding: string;
  payloadHash: string;
  requirements: PaymentRequirements;
  payer: string;
  nonce: string;
  resource: string;
  createdAt: string;
  result?: unknown;
  settlement?: SettleResponse;
}

/** Verifies and settles signed payments. `httpFacilitator` talks to an x402 facilitator over HTTP. */
export interface Facilitator {
  verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<{ isValid: boolean; payer?: string }>;
  settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse>;
}

/** The x402 "exact" offer for an EIP-3009 USDC payment of `amount` (atomic units) to `payTo`. */
export function exactUsdcRequirements(o: {
  chainId: number;
  asset: Address;
  amount: string;
  payTo: Address;
  maxTimeoutSeconds?: number;
}): PaymentRequirements {
  return {
    scheme: 'exact',
    network: `eip155:${o.chainId}`,
    asset: o.asset,
    amount: o.amount,
    payTo: o.payTo,
    maxTimeoutSeconds: o.maxTimeoutSeconds ?? 300,
    extra: { name: 'USDC', version: '2', assetTransferMethod: 'eip3009' },
  };
}

/**
 * The manifest a Bondrail x402 business serves at `/.well-known/slice.json`: its account and every paid
 * endpoint (each an unpaid GET returning the 402 offer). The covenant check, the marketplace's domain proof
 * and guarded buyers (`sliceGuard`) all read it.
 */
export function sliceManifest(o: { chainId: number; account: Address; endpoints: string[] }): SliceManifest {
  return { version: 1, chainId: o.chainId, account: o.account, endpoints: o.endpoints };
}

export function manifestResponse(manifest: SliceManifest): Response {
  return Response.json(manifest, {
    headers: { 'Cache-Control': 'public, max-age=60', 'Access-Control-Allow-Origin': '*' },
  });
}

export function decodePayment(header: string): { payload: PaymentPayload; payer: string; nonce: string } {
  const p = decodeBase64Json(header);
  if (
    !isRecord(p) ||
    p.x402Version !== 2 ||
    !isRecord(p.accepted) ||
    !isRecord(p.payload) ||
    !isRecord(p.payload.authorization) ||
    typeof p.payload.signature !== 'string' ||
    !/^0x[0-9a-fA-F]{130}$/.test(p.payload.signature)
  )
    throw new Error('Malformed payment');
  const a = p.payload.authorization;
  if (
    !address(a.from) ||
    !address(a.to) ||
    typeof a.nonce !== 'string' ||
    !/^0x[0-9a-fA-F]{64}$/.test(a.nonce) ||
    typeof a.value !== 'string' ||
    !/^\d+$/.test(a.value)
  )
    throw new Error('Malformed authorization');
  return { payload: p as unknown as PaymentPayload, payer: a.from.toLowerCase(), nonce: a.nonce.toLowerCase() };
}

export function paymentKey(chainId: number, asset: string, payer: string, nonce: string) {
  return `payment:${digest({ chainId, asset: asset.toLowerCase(), payer: payer.toLowerCase(), nonce: nonce.toLowerCase() })}`;
}

function response(status: number, data: unknown, headers: Record<string, string> = {}) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store', ...headers } });
}

export interface PaidRequest {
  /** The PAYMENT-SIGNATURE request header, or null on the first (unpaid) call. */
  header: string | null;
  /** Canonical URL of this exact resource; a payment is bound to it. */
  resource: string;
  description: string;
  requirements: PaymentRequirements;
  store: DurableStore;
  facilitator: Facilitator;
  /** The paid work. Runs at most once per payment; its result is journaled before settlement. */
  work: () => Promise<unknown>;
  /** When false (e.g. a missing provider key), paid calls get 503 and nobody is charged. */
  available?: boolean;
  /** Name of the result field in the 200 response (default "result"). */
  resultField?: string;
}

export async function handlePaidRequest(r: PaidRequest): Promise<Response> {
  const required = r.requirements;
  const field = r.resultField ?? 'result';
  const challenge = () =>
    response(
      402,
      { error: 'payment_required' },
      {
        'PAYMENT-REQUIRED': Buffer.from(
          JSON.stringify({
            x402Version: 2,
            resource: { url: r.resource, description: r.description, mimeType: 'application/json' },
            accepts: [required],
          }),
        ).toString('base64'),
      },
    );
  const completed = (record: PaymentRecord) =>
    response(
      200,
      { [field]: record.result, payment: record.settlement },
      { 'PAYMENT-RESPONSE': Buffer.from(JSON.stringify(record.settlement)).toString('base64') },
    );

  if (!r.header) return challenge();
  let decoded: ReturnType<typeof decodePayment>;
  try {
    decoded = decodePayment(r.header);
  } catch {
    return response(400, { error: 'malformed_payment' });
  }
  const { payload, payer, nonce } = decoded;
  const chainId = Number(required.network.split(':')[1]);
  const key = paymentKey(chainId, required.asset, payer, nonce);
  const binding = digest({ resource: r.resource }),
    payloadHash = digest(payload),
    old = await r.store.get(key);
  if (old) {
    const record = JSON.parse(old) as PaymentRecord;
    if (record.binding !== binding || record.payloadHash !== payloadHash)
      return response(409, { error: 'authorization_already_bound_to_another_request' });
    if (record.state === 'complete') return completed(record);
    return response(
      record.state === 'work_failed' ? 502 : 202,
      {
        status: record.state,
        paymentKey: key,
        message: 'Retry this same signed request. Do not issue a new authorization while settlement is unresolved.',
      },
      { 'Retry-After': '5' },
    );
  }
  if (r.available === false) return response(503, { error: 'service_unavailable', charged: false });
  if (canonical(payload.accepted) !== canonical(required) || (payload.resource && payload.resource.url !== r.resource))
    return challenge();
  const authorization = payload.payload.authorization as Record<string, unknown>;
  if (
    String(authorization.to).toLowerCase() !== required.payTo.toLowerCase() ||
    authorization.value !== required.amount
  )
    return challenge();
  const verified = await r.facilitator.verify(payload, required);
  if (!verified.isValid || verified.payer?.toLowerCase() !== payer) return challenge();

  let record: PaymentRecord = {
    state: 'processing',
    binding,
    payloadHash,
    requirements: required,
    payer,
    nonce,
    resource: r.resource,
    createdAt: new Date().toISOString(),
  };
  let raw = JSON.stringify(record);
  if (!(await r.store.cas(key, null, raw)))
    return response(202, { status: 'processing', paymentKey: key }, { 'Retry-After': '5' });
  try {
    record = { ...record, result: await r.work(), state: 'settlement_pending' };
  } catch {
    record = { ...record, state: 'work_failed' };
    await r.store.cas(key, raw, JSON.stringify(record));
    return response(502, { error: 'work_failed', charged: false });
  }
  const pending = JSON.stringify(record);
  if (!(await r.store.cas(key, raw, pending))) throw new Error('Payment journal conflict');
  raw = pending;
  // Journal the result before settlement: a timeout leaves reconcilable work; never rerun or re-charge.
  try {
    const settlement = await r.facilitator.settle(payload, required);
    if (
      !settlement.success ||
      !/^0x[0-9a-fA-F]{64}$/.test(settlement.transaction) ||
      settlement.network !== required.network ||
      settlement.payer?.toLowerCase() !== payer
    )
      return response(202, { status: 'settlement_pending', paymentKey: key }, { 'Retry-After': '5' });
    record = { ...record, state: 'complete', settlement };
    if (!(await r.store.cas(key, raw, JSON.stringify(record)))) throw new Error('Payment journal conflict');
    return completed(record);
  } catch {
    return response(
      202,
      {
        status: 'settlement_pending',
        paymentKey: key,
        message: 'Payment outcome needs receipt reconciliation; reuse the same authorization.',
      },
      { 'Retry-After': '5' },
    );
  }
}

/** Facilitator over HTTP (e.g. Monad's https://x402-facilitator.molandak.org). */
export function httpFacilitator(url: string, chainId: number): Facilitator {
  let server: x402ResourceServer | undefined;
  const ready = async () => {
    if (!server) {
      server = new x402ResourceServer(new HTTPFacilitatorClient({ url, timeoutMs: 15000 })).register(
        `eip155:${chainId}`,
        new ExactEvmScheme(),
      );
      await server.initialize();
    }
    return server;
  };
  return {
    verify: async (p, r) => (await ready()).verifyPayment(p, r),
    settle: async (p, r) => (await ready()).settlePayment(p, r),
  };
}

const settlementAbi = parseAbi([
  'event Transfer(address indexed from,address indexed to,uint256 value)',
  'event AuthorizationUsed(address indexed authorizer,bytes32 indexed nonce)',
]);

/** True when a settlement receipt shows this exact authorization moving the exact amount to payTo. */
export function receiptProvesPayment(
  p: PaymentRecord,
  logs: readonly { address: Address; data: Hex; topics: readonly Hex[] }[],
): boolean {
  let transfer = false,
    authorization = false;
  for (const log of logs) {
    if (log.address.toLowerCase() !== p.requirements.asset.toLowerCase()) continue;
    try {
      const event = decodeEventLog({ abi: settlementAbi, data: log.data, topics: [...log.topics] as [Hex, ...Hex[]] });
      if (event.eventName === 'Transfer')
        transfer ||=
          event.args.from.toLowerCase() === p.payer &&
          event.args.to.toLowerCase() === p.requirements.payTo.toLowerCase() &&
          event.args.value === BigInt(p.requirements.amount);
      if (event.eventName === 'AuthorizationUsed')
        authorization ||= event.args.authorizer.toLowerCase() === p.payer && event.args.nonce.toLowerCase() === p.nonce;
    } catch {
      /* Unrelated token event. */
    }
  }
  return transfer && authorization;
}
