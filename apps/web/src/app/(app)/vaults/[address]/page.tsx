import { isAddress } from 'viem';
import { notFound } from 'next/navigation';
import { CreditVault } from '@/components/app/vault';
export const metadata = { title: 'Vault' };
export default async function Page({ params, searchParams }: { params: Promise<{ address: string }>; searchParams: Promise<{ action?: string }> }) {
  const { address } = await params;
  if (!isAddress(address)) notFound();
  const { action } = await searchParams;
  return <CreditVault address={address} initialAction={action === 'withdraw' ? 'withdraw' : 'deposit'} />;
}
