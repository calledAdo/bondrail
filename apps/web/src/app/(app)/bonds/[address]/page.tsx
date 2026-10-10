import { BondPage } from '@/components/app/details';

export const metadata = { title: 'Bond' };
export default async function Page({ params }: { params: Promise<{ address: string }> }) {
  return <BondPage address={(await params).address} />;
}
