// The agent's Bondrail manifest: its SliceAccount and every paid endpoint. Chainlink CRE checks it with the
// endpoints, guarded buyers refuse offers that pay anyone else, and the marketplace uses it as domain proof.
// The account is fixed in the deployment's environment, not in the mutable payTo config.
import { manifestResponse, sliceManifest } from '@bondrail/sdk/x402';
import { environment } from '../../../lib/config';
import { resourceURL } from '../../../lib/payment';
import { address } from '@bondrail/observer/protocol';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const env = environment(),
      account = process.env.AGENT_SLICE_ACCOUNT ?? process.env.AGENT_INITIAL_PAY_TO;
    if (!address(account)) throw new Error('AGENT_SLICE_ACCOUNT missing');
    return manifestResponse(
      sliceManifest({ chainId: env.chainId, account, endpoints: [resourceURL(env, 'health')] }),
    );
  } catch {
    return Response.json({ error: 'manifest_unavailable' }, { status: 503 });
  }
}
