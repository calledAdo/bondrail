// Run after the CRE reporter has posted a fresh compliant observation. Safe to repeat.
import { account, artifact, assertChain, publicClient, readDeployment, write } from './lib.ts';
async function main() {
  await assertChain();
  const d = readDeployment();
  const bond = d.issuers.agent?.bond;
  if (!bond) throw new Error('Set up the agent bond first');
  const phase = await publicClient.readContract({ address: bond, abi: artifact('BondrailBond').abi, functionName: 'phase' });
  if (phase !== 0) { console.log('Watched bond already activated or terminal'); return; }
  await write(account('agent-issuer'), d.factory, artifact('BondrailFactory').abi, 'activate', [bond]);
  console.log(`Activated Watched bond ${bond}`);
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
