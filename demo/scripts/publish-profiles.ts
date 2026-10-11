// Publishes the demo businesses' marketplace records to the web registry: each profile signed (EIP-712) by
// the account's issuer, and PumpLab's Kuru market by its MarketRegistered transaction.
//
//   WEB_URL=https://<web> KURU_TX=0x... pnpm tsx demo/scripts/publish-profiles.ts
import { account, chainId, readDeployment } from '../../scripts/lib.ts';

const web = process.env.WEB_URL ?? 'http://127.0.0.1:3000';
const profiles = {
  pumplab: {
    key: 'pumplab-issuer',
    name: 'PumpLab',
    description: 'A token launchpad on Monad. Every trading fee is paid into its Slice account in code.',
    website: '',
    x: '',
    useOfFunds: 'Liquidity incentives for new launches and an audit of the launchpad contracts.',
  },
  agent: {
    key: 'agent-issuer',
    name: 'Oracle Agent',
    description: 'A paid AI answer API. Callers pay 0.01 USDC per request over x402, straight to its Slice account.',
    website: 'https://slice-agent.vercel.app',
    x: '',
    useOfFunds: 'Model inference credits and hosting for the next six months.',
  },
  curvelab: {
    key: 'curvelab-issuer',
    name: 'CurveLab',
    description: 'A token launchpad deployed from the reviewed PumpLab template. Its raise is open to anyone until 28 October.',
    website: '',
    x: '',
    useOfFunds: 'Launch incentives and market-making for the first month.',
  },
};

async function post(body: unknown) {
  const r = await fetch(`${web}/api/registry`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error);
  return j;
}

async function main() {
  const d = readDeployment();
  for (const [id, p] of Object.entries(profiles)) {
    const issuer = d.issuers[id];
    if (!issuer) continue;
    const profile = { account: issuer.account, name: p.name, description: p.description, website: p.website, x: p.x, useOfFunds: p.useOfFunds, updatedAt: BigInt(Math.floor(Date.now() / 1000)) };
    const signature = await account(p.key).signTypedData({
      domain: { name: 'Slice Profile', version: '1', chainId },
      types: {
        Profile: [
          { name: 'account', type: 'address' },
          { name: 'name', type: 'string' },
          { name: 'description', type: 'string' },
          { name: 'website', type: 'string' },
          { name: 'x', type: 'string' },
          { name: 'useOfFunds', type: 'string' },
          { name: 'updatedAt', type: 'uint64' },
        ],
      },
      primaryType: 'Profile',
      message: profile,
    });
    const r = await post({ type: 'profile', profile: { ...profile, updatedAt: String(profile.updatedAt) }, signature });
    console.log(`  ${p.name}: profile stored (domain verified: ${r.domainVerified})`);
  }
  if (process.env.KURU_TX) {
    const r = await post({ type: 'kuru', tx: process.env.KURU_TX });
    console.log(`  Kuru market ${r.market} for ${r.bond}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
