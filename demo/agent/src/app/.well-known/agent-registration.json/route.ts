// ERC-8004 agent registration file: what this agent is, where to call it, and how it is paid.
// AGENT_ERC8004_ID is set after scripts/erc8004.ts registers the agent on Monad testnet.
const IDENTITY_REGISTRY = '0x8004A818BFB912233c491871b3d84c89A494BD9e';

export function GET() {
  const base = process.env.AGENT_PUBLIC_URL ?? 'https://bondrail-next-agent.vercel.app';
  const id = process.env.AGENT_ERC8004_ID;
  return Response.json(
    {
      type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
      name: 'Oracle Agent',
      description:
        'Paid Q&A API. Each call costs 0.01 test USDC via x402 and is paid to its BondrailAccount, which shares revenue with bondholders while a bond is active.',
      services: [{ name: 'x402', endpoint: `${base}/api/oracle`, version: '2' }],
      x402Support: true,
      active: true,
      registrations: id ? [{ agentId: Number(id), agentRegistry: `eip155:10143:${IDENTITY_REGISTRY}` }] : [],
      supportedTrust: ['reputation'],
    },
    { headers: { 'Cache-Control': 'public, max-age=60' } },
  );
}
