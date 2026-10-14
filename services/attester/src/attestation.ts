import { isAddress, keccak256, stringToHex, type Address } from 'viem';
import { defaultCreditTerms, indexedCreditMetrics, type CreditAttestation } from '@bondrail/sdk/credit';
import { graphql, type EnvioOptions } from '@bondrail/scoring/envio';

export interface CreditInputs {
  chainId: number;
  registry: Address;
  account: Address;
  issuer: Address;
  asset: Address;
  periodEnd: number;
  firstRevenueAt: number | null;
  grossRevenue: string;
  payers: { id: string; account: string; payer: string; amount: string; related: boolean; reasons: string[] }[];
  daily: { id: string; account: string; day: number; gross: string; verified: string }[];
}
const UINT256 = (1n << 256n) - 1n;
const DAY = 86_400;
function uint(value: string) {
  if (!/^(0|[1-9][0-9]*)$/.test(value) || BigInt(value) > UINT256) throw new Error('Invalid uint256 input');
  return BigInt(value);
}
function seconds(n: number) {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('Invalid timestamp');
  return n;
}
function address(a: string): Address {
  if (!isAddress(a, { strict: false })) throw new Error('Invalid address input');
  return a.toLowerCase() as Address;
}
/** Canonical UTF-8 JSON: recursive key order, no whitespace, no floats/non-finite values/bigints. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
  }
  throw new Error('Unsupported canonical JSON value');
}

export function buildAttestation(raw: CreditInputs, options: { issuedAt: number; expiresAt: number; nonce: bigint }) {
  const account = address(raw.account);
  const periodEnd = seconds(raw.periodEnd);
  const first = raw.firstRevenueAt === null ? null : seconds(raw.firstRevenueAt);
  if (!Number.isSafeInteger(raw.chainId) || raw.chainId <= 0 || periodEnd === 0 || (first !== null && first > periodEnd))
    throw new Error('Invalid chain or history');
  if (seconds(options.issuedAt) < periodEnd || seconds(options.expiresAt) <= options.issuedAt)
    throw new Error('Invalid attestation lifetime');
  if (options.nonce < 0n || options.nonce > UINT256) throw new Error('Invalid nonce');
  const seenPayers = new Set<string>();
  const payers = raw.payers.map((row) => {
    const payer = address(row.payer);
    if (address(row.account) !== account || seenPayers.has(payer)) throw new Error('Wrong account or duplicate payer');
    seenPayers.add(payer);
    uint(row.amount);
    if (typeof row.related !== 'boolean' || !Array.isArray(row.reasons) || row.reasons.some((r) => typeof r !== 'string'))
      throw new Error('Invalid payer attribution');
    return { ...row, account, payer, reasons: [...new Set(row.reasons)].sort() };
  }).sort((a, b) => a.payer < b.payer ? -1 : a.payer > b.payer ? 1 : 0);
  const seenDays = new Set<number>();
  const today = Math.floor(periodEnd / DAY);
  const daily = raw.daily.map((row) => {
    if (address(row.account) !== account || !Number.isSafeInteger(row.day) || row.day <= today - 7 || row.day > today || seenDays.has(row.day))
      throw new Error('Wrong account, duplicate or out-of-window daily row');
    seenDays.add(row.day);
    if (uint(row.verified) > uint(row.gross)) throw new Error('Verified revenue exceeds gross');
    return { ...row, account };
  }).sort((a, b) => a.day - b.day);
  const total = payers.reduce((sum, p) => sum + uint(p.amount), 0n);
  if (total !== uint(raw.grossRevenue)) throw new Error('Payer totals do not reconcile to indexed revenue');
  if (!first && total > 0n) throw new Error('Revenue without history start');
  const inputs: CreditInputs = { ...raw, account, registry: address(raw.registry), issuer: address(raw.issuer),
    asset: address(raw.asset), payers, daily };
  const metrics = indexedCreditMetrics({ now: periodEnd, firstRevenueAt: first ?? undefined,
    payers: payers.map((p) => ({ amount: uint(p.amount), related: p.related })),
    daily: daily.map((d) => ({ day: d.day, verified: uint(d.verified) })) });
  if (metrics.creditLine > UINT256) throw new Error('Credit line exceeds uint256');
  // Stringify fractional policy constants explicitly; amounts and nonce also use decimal strings.
  const creditTerms = Object.fromEntries(Object.entries(defaultCreditTerms).map(([k, v]) => [k, String(v)]));
  const evidence = canonicalJson({ policy: 'bondrail-web-credit-v1', creditTerms, inputs,
    issuedAt: options.issuedAt, expiresAt: options.expiresAt, nonce: String(options.nonce) });
  const attestation: CreditAttestation = {
    account, chainId: BigInt(raw.chainId), periodStart: BigInt(first || periodEnd - 1), periodEnd: BigInt(periodEnd),
    attributedRevenue: metrics.attributedRevenue, excludedRevenue: metrics.excludedRevenue,
    distinctPayers: BigInt(metrics.distinctPayers), topPayerShareBps: metrics.topPayerShareBps,
    creditLine: metrics.creditLine, evidenceHash: keccak256(stringToHex(evidence)),
    issuedAt: BigInt(options.issuedAt), expiresAt: BigInt(options.expiresAt), nonce: options.nonce,
  };
  if (attestation.periodStart >= attestation.periodEnd) throw new Error('Wait until history has a nonzero duration');
  return { attestation, evidence, inputs };
}

/** Exhaustive keyset pagination, bounded to 100k rows. Never sign a truncated aggregate set. */
export async function readIndexedInputs(options: EnvioOptions, request: { account: Address; registry: Address; chainId: number; periodEnd: number }) {
  const account = address(request.account);
  async function issuer() {
    const data = await graphql<{ Issuer: { id: string; chainId: number; issuer: Address; asset: Address; firstRevenueAt: string | null; grossRevenue: string }[] }>(options,
      'query Account($account: String!, $chain: Int!) { Issuer(where: {id: {_eq: $account}, chainId: {_eq: $chain}}) { id chainId issuer asset firstRevenueAt grossRevenue } }',
      { account, chain: request.chainId });
    if (data.Issuer.length !== 1) throw new Error('Account missing on the requested indexer chain');
    return data.Issuer[0];
  }
  async function snapshot() {
    const owner = await issuer();
    const payers: CreditInputs['payers'] = [];
    let cursor = '';
    for (let page = 0; ; page++) {
      if (page === 100) throw new Error('Payer pagination limit reached');
      const data = await graphql<{ PayerTotal: CreditInputs['payers'] }>(options,
        `query Payers($account: String!, $cursor: String!) { PayerTotal(where: {account: {_eq: $account}, id: {_gt: $cursor}}, order_by: {id: asc}, limit: 1000) { id account payer amount related reasons } }`,
        { account, cursor });
      for (const row of data.PayerTotal) {
        if (row.id <= cursor) throw new Error('Non-advancing payer pagination');
        cursor = row.id;
        payers.push(row);
      }
      if (data.PayerTotal.length < 1000) break;
    }
    const today = Math.floor(request.periodEnd / DAY);
    const data = await graphql<{ DailyRevenue: CreditInputs['daily'] }>(options,
      `query Days($account: String!, $from: Int!, $to: Int!) { DailyRevenue(where: {account: {_eq: $account}, day: {_gte: $from, _lte: $to}}, order_by: {day: asc}, limit: 8) { id account day gross verified } }`,
      { account, from: today - 6, to: today });
    if (data.DailyRevenue.length > 7) throw new Error('Unexpected daily aggregate count');
    return { ...request, account, issuer: owner.issuer, asset: owner.asset,
      firstRevenueAt: owner.firstRevenueAt === null ? null : Number(owner.firstRevenueAt),
      grossRevenue: owner.grossRevenue, payers, daily: data.DailyRevenue } satisfies CreditInputs;
  }
  // Aggregates are mutable, not historical block queries. Require two identical reads; this
  // detects concurrent indexing, but does not prove completeness/finality of the indexer.
  const first = await snapshot();
  const second = await snapshot();
  if (canonicalJson(first) !== canonicalJson(second)) throw new Error('Indexer changed during snapshot; retry');
  return first;
}
