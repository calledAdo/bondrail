import { storeFromEnv } from '@slice/observer/store';
import { environment, getConfig } from '../../../lib/config';
export const dynamic = 'force-dynamic';
export async function GET() {
  const checks: { name: string; ready: boolean }[] = [];
  let env: ReturnType<typeof environment> | undefined;
  try {
    env = environment();
    checks.push({ name: 'payment_environment', ready: true });
  } catch {
    checks.push({ name: 'payment_environment', ready: false });
  }
  checks.push(
    { name: 'model_credentials', ready: !!env?.apiKey },
    {
      name: 'admin_token',
      ready: (process.env.AGENT_ADMIN_TOKEN?.length ?? 0) >= 32,
    },
  );
  try {
    const store = storeFromEnv();
    await store.get('health');
    checks.push({ name: 'durable_store', ready: true });
    try {
      await getConfig(store);
      checks.push({ name: 'payment_recipient', ready: true });
    } catch {
      checks.push({ name: 'payment_recipient', ready: false });
    }
  } catch {
    checks.push({ name: 'durable_store', ready: false });
  }
  const ready = checks.every((c) => c.ready);
  return Response.json(
    {
      status: ready ? 'ready' : 'not_ready',
      checks,
      network: env?.chainId,
      providerConnectivity: 'not tested by this diagnostic',
    },
    { status: ready ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
