import { MarketPage } from '@/components/market-page';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MarketPage id={id} issuer />;
}
