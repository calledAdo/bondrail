// Run after the CRE reporter has posted a fresh compliant observation. Safe to repeat.
import { account, artifact, assertChain, publicClient, readDeployment, write } from './lib.ts';
import { checkWatchedPolicy } from '../demo/scripts/watched-preflight.ts';
async function main() {
  await assertChain();
  const d = readDeployment();
  const bond = d.issuers.agent?.bond;
  if (!bond) throw new Error('Set up the agent bond first');
  const phase = await publicClient.readContract({ address: bond, abi: artifact('BondrailBond').abi, functionName: 'phase' });
  if (phase !== 0) { console.log('Watched bond already activated or terminal'); return; }
  const healthy = await publicClient.readContract({
    address: d.covenant, abi: artifact('BondrailCovenant').abi, functionName: 'isHealthy', args: [bond],
  });
  if (!healthy) {
    // The chain stores the result, not the parser reason. Diagnose current HTTP state without signing
    // or posting a report; a currently compliant probe still cannot authorize activation.
    if (d.watchPolicy) {
      const result = await checkWatchedPolicy(d.watchPolicy);
      console.error(`Current observer check: ${['Unknown', 'Compliant', 'Violation'][result.result]} (${result.reason})`);
    }
    throw new Error('No fresh compliant CRE report: fix any observer reason above, then run the CRE broadcast before activation');
  }
  await write(account('agent-issuer'), d.factory, artifact('BondrailFactory').abi, 'activate', [bond]);
  console.log(`Activated Watched bond ${bond}`);
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
