import { BondPage } from '@/components/app/details';
import { isAddress } from 'viem';
import { bondQuery } from '@/lib/protocol-data';
import { fetchIndex, INDEXER_URL } from '@/lib/protocol-indexer';

export const metadata = { title: 'Bond' };
export default async function Page({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  const started = Date.now();
  // Send the indexed summary in the first HTML, avoiding hydration + cross-origin connection setup.
  // A failed indexer read leaves the client retry/error UI available.
  const initialData = INDEXER_URL && isAddress(address) ? await fetchIndex(bondQuery, address, true).catch(() => undefined) : undefined;
  const indexedAt = Date.now();
  return <><meta name="bondrail:indexer-ms" content={String(indexedAt - started)} /><meta name="bondrail:indexer-requests" content={initialData ? '1' : '0'} /><BondPage address={address} initialData={initialData} indexedAt={indexedAt} /></>;
}
