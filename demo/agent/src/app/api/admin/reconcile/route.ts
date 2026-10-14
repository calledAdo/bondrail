import { storeFromEnv } from '@bondrail/observer/store';
import { authorized } from '@bondrail/observer/auth';
import { environment } from '../../../../lib/config';
import { reconcile } from '../../../../lib/reconcile';
import type { Hex } from 'viem';
export async function POST(request: Request) {
  if (!authorized(request.headers.get('authorization'), process.env.AGENT_ADMIN_TOKEN))
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const raw = await request.text();
    if (raw.length > 1024) return Response.json({ error: 'too_large' }, { status: 413 });
    const { paymentKey, transaction } = JSON.parse(raw) as {
      paymentKey: string;
      transaction: Hex;
    };
    const env = environment(),
      rpc = process.env.BONDRAIL_RPC_URL;
    if (!rpc) throw new Error('RPC unavailable');
    return Response.json(await reconcile(storeFromEnv(), paymentKey, transaction, rpc, env.chainId));
  } catch {
    return Response.json({ error: 'receipt_reconciliation_failed' }, { status: 409 });
  }
}
