import { AccountPage } from '@/components/app/details';

export const metadata = { title: 'Credit profile' };
export default async function Page({ params }: { params: Promise<{ address: string }> }) {
  return <AccountPage address={(await params).address} />;
}
