// Shared server/client transport. Server summaries use Next's bounded data cache; client polling stays fresh.
import { emptyIndex, type IndexerData } from './protocol-data';
export const INDEXER_URL = process.env.NEXT_PUBLIC_INDEXER_URL || '';
export async function fetchIndex(query: string, address?: string, server = false): Promise<IndexerData> {
  const response = await fetch(INDEXER_URL, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables: address ? { address: address.toLowerCase() } : undefined }),
    signal: AbortSignal.timeout(8000),
    ...(server ? { next: { revalidate: 30 } } : { cache: 'no-store' as const }),
  });
  const result = await response.json();
  if (!response.ok || result.errors) throw new Error(result.errors?.[0]?.message ?? 'Indexer query failed');
  return { ...emptyIndex, ...result.data };
}
