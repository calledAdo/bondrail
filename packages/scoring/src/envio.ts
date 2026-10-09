import { calculateScore, type RevenuePayment, type RevenueWindow } from './index.ts';

export interface EnvioOptions {
  url: string;
  adminSecret?: string;
  fetch?: typeof fetch;
}
export async function graphql<T>(
  options: EnvioOptions,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const u = new URL(options.url);
  if (!['https:', 'http:'].includes(u.protocol)) throw new Error('Invalid indexer URL');
  const response = await (options.fetch ?? fetch)(u, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(options.adminSecret ? { 'x-hasura-admin-secret': options.adminSecret } : {}),
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Indexer returned HTTP ${response.status}`);
  const result = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (result.errors?.length || !result.data)
    throw new Error('Indexer query failed; check generated schema and endpoint');
  return result.data;
}

/** Explicit checkpoint comes from reconciliation, not merely the indexer's newest event. */
export async function indexedScore(options: EnvioOptions, window: Omit<RevenueWindow, 'payments'>) {
  const payments: RevenuePayment[] = [];
  let cursor = '';
  for (let page = 0; page < 100; page++) {
    const result = await graphql<{
      Payment: Array<{
        id: string;
        chainId: number;
        account: string;
        payer: string;
        amount: string;
        timestamp: string;
        source: string;
        synthetic: boolean;
        related: boolean;
        evidenceComplete: boolean;
        reasons: string[];
      }>;
    }>(
      options,
      `
        query Revenue($account: String!, $chain: Int!, $from: BigInt!, $to: BigInt!, $cursor: String!) {
          Payment(
            where: {
              account: { _eq: $account }
              chainId: { _eq: $chain }
              timestamp: { _gte: $from, _lt: $to }
              id: { _gt: $cursor }
            }
            order_by: { id: asc }
            limit: 1000
          ) {
            id
            chainId
            account
            payer
            amount
            timestamp
            source
            synthetic
            related
            evidenceComplete
            reasons
          }
        }
      `,
      {
        account: window.account.toLowerCase(),
        chain: window.chainId,
        from: String(window.from),
        to: String(window.to),
        cursor,
      },
    );
    for (const row of result.Payment) {
      if (row.source !== 'launchpad' && row.source !== 'x402')
        throw new Error('Unknown source in recognized payment ledger');
      payments.push({ ...row, timestamp: Number(row.timestamp), source: row.source });
    }
    if (result.Payment.length < 1000) return calculateScore({ ...window, payments });
    cursor = result.Payment[result.Payment.length - 1].id;
  }
  // Never silently treat a truncated dataset as complete underwriting.
  return calculateScore({ ...window, coverageComplete: false, payments });
}
