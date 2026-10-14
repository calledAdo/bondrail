import { deploymentName } from '../../scripts/deployment-path.mjs';
const deploymentSuffix = deploymentName() === 'main' ? '' : `-${deploymentName()}`;
// Read-only preparation. Keys stay in Node memory; output contains public addresses/balances only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPublicClient, http, erc20Abi, formatUnits, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { monadTestnet } from 'viem/chains';

const deployment = JSON.parse(fs.readFileSync(new URL(`../../docs/deployments/${process.env.BONDRAIL_CHAIN_ID ?? '10143'}${deploymentSuffix}.json`, import.meta.url)));
const client = createPublicClient({ chain: monadTestnet, transport: http('https://testnet-rpc.monad.xyz', { retryCount: 3 }) });
if (await client.getChainId() !== 10143) throw new Error('Monad testnet required');
for (const name of ['kuru-trader', 'investor', 'pumplab-organic-0']) {
  const raw = fs.readFileSync(path.join(os.homedir(), '.slice', `${name}.key`), 'utf8').trim();
  const account = privateKeyToAccount(raw.startsWith('0x') ? raw : `0x${raw}`);
  const [mon, cash, claims] = await Promise.all([
    client.getBalance({ address: account.address }),
    client.readContract({ address: deployment.asset, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] }),
    client.readContract({ address: deployment.issuers.pumplab.bond, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] }),
  ]);
  console.log(JSON.stringify({ wallet: name, address: account.address, mon: formatUnits(mon, 18), usdc: formatUnits(cash, 6), claims: formatUnits(claims, 6) }));
}
const abi = parseAbi(['function phase() view returns (uint8)', 'function totalRevenueCollected() view returns (uint256)', 'function backingPerToken() view returns (uint256)', 'function fundingEscrow() view returns (uint256)']);
for (const name of ['pumplab', 'curvelab', 'agent']) {
  const address = deployment.issuers[name].bond;
  const phase = await client.readContract({ address, abi, functionName: 'phase' });
  console.log(JSON.stringify({ bond: name, address, phase }));
}
