import { storeFromEnv } from '@slice/observer/store';
import { environment, getConfig } from '../../../lib/config.js';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const env = environment(),
      config = await getConfig(storeFromEnv());
    return Response.json(
      {
        revision: config.revision,
        payTo: config.payTo,
        updatedAt: config.updatedAt,
        chainId: env.chainId,
        asset: env.asset,
        priceAtomic: '10000',
        priceUSD: '0.01',
        model: env.model,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return Response.json({ error: 'configuration_unavailable' }, { status: 503 });
  }
}
