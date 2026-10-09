// Activates the Oracle Agent's Watched bond. The factory requires a fresh (<= 90 s) compliant
// observation delivered by Chainlink CRE, so run a CRE broadcast immediately before this.
import { artifact, account, publicClient, readDeployment, write } from '../../scripts/lib.ts';

async function main() {
  const d = readDeployment();
  const a = d.issuers.agent;
  if (!a?.bond) throw new Error('Run setup-demo.ts with AGENT_URL first');
  const healthy = await publicClient.readContract({
    address: d.covenant,
    abi: artifact('SliceCovenant').abi,
    functionName: 'isHealthy',
    args: [a.bond],
  });
  if (!healthy) throw new Error('No fresh compliant CRE observation: run the CRE broadcast first');
  const r = await write(account('agent-issuer'), d.factory, artifact('SliceFactory').abi, 'activate', [
    a.bond,
  ]);
  console.log(`Activated ${a.bond} in tx ${r.transactionHash}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
