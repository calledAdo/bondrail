import { isAddress } from 'viem';
import { redirect } from 'next/navigation';
export default function Page() {
  const address = process.env.NEXT_PUBLIC_VAULT_ADDRESS;
  redirect(address && isAddress(address) ? `/vaults/${address}` : '/vaults');
}
