// Minimal paid resource for the rehearsal: real SDK journal + real HTTP facilitator, no model API.
import { createServer } from 'node:http';
import { handlePaidRequest, httpFacilitator, exactUsdcRequirements } from '../packages/sdk/src/x402.ts';
import { LocalStore } from '../services/observer/src/store.ts';
import { assertChain, chainId, readDeployment } from './lib.ts';
async function main() {
  if (chainId !== 31337) throw new Error('Local endpoint requires anvil');
  await assertChain();
  const d = readDeployment();
  const origin = process.env.LOCAL_AGENT_ORIGIN!;
  const url = `${origin}/api/oracle`;
  if (new URL(origin).hostname !== '127.0.0.1') throw new Error('Loopback endpoint only');
  const requirements = { ...exactUsdcRequirements({ chainId, asset: d.asset, amount: '10000', payTo: d.issuers.agent!.account }),
    extra: { name: 'LOCAL TEST USDC', version: '1', assetTransferMethod: 'eip3009' } };
  const facilitator = httpFacilitator(process.env.X402_FACILITATOR_URL!, chainId);
  const store = new LocalStore(process.env.BONDRAIL_DATA_DIR!);
  const server = createServer(async (req, res) => {
    try {
      const response = req.url === '/.well-known/bondrail.json'
        ? Response.json({ version: 1, chainId, account: requirements.payTo, endpoints: [url] })
        : await handlePaidRequest({ header: typeof req.headers['payment-signature'] === 'string' ? req.headers['payment-signature'] : null,
          resource: url, description: 'Local oracle', requirements, store, facilitator, work: async () => 'Local oracle response', resultField: 'answer' });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(await response.text());
    } catch { res.writeHead(500); res.end('Local endpoint failed'); }
  });
  server.listen(Number(new URL(origin).port), '127.0.0.1');
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
