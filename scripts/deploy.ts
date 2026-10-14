// Full protocol deployment. Existing manifests require --force; reruns resume/verify this deployment.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { keccak256, parseEther, type Address } from 'viem';
import {
  account, artifact, assertChain, assertDeploymentWritable, chain, chainId, deploy,
  DEPLOYMENT, deploymentFile, publicClient, readDeployment, saveDeployment, wallet, write,
  type DeploymentFile,
} from './lib.ts';
import { writeJson } from './deployment-path.mjs';

const TESTNET_USDC: Address = '0x534b2f3A21130d7a60830c2Df862319e593943A3';
const TESTNET_CRE_FORWARDER: Address = '0xB9F79d863261869B234c481D1f9A7af84AeAd192';
const gasTargets = { reviewer: '0.2', attester: '0.2', curator: '0.2', facilitator: '0.5', worker: '0.5' };

async function main() {
  // Refuse before loading keys, funding roles or broadcasting anything.
  assertDeploymentWritable();
  await assertChain();
  const deployer = account('deployer', { fallbackFile: path.join(os.homedir(), '.zeitgeist/testnet-deployer.key') });
  const roles: Record<string, Address> = { deployer: deployer.address };
  for (const name of ['observer', 'milestone', 'reviewer', 'attester', 'curator', 'facilitator', 'worker'])
    roles[name] = account(name, { create: true }).address;
  const minHistory = Number(process.env.BONDRAIL_MIN_HISTORY ?? (chainId === 31337 ? 60 : 600));
  if (!Number.isSafeInteger(minHistory) || minHistory < 0) throw new Error('Invalid BONDRAIL_MIN_HISTORY');
  const templateHash = keccak256(artifact('PumpLab').bytecode);
  const journal = `${deploymentFile}.pending`;
  const existing = fs.existsSync(deploymentFile) ? readDeployment() : undefined;
  const d: Partial<DeploymentFile> = existing ?? (fs.existsSync(journal)
    ? JSON.parse(fs.readFileSync(journal, 'utf8')) as Partial<DeploymentFile>
    : { schemaVersion: 1, deployment: DEPLOYMENT, chainId, network: chain.name,
        deployedAt: new Date().toISOString(), startBlock: String(await publicClient.getBlockNumber()),
        deployer: deployer.address, roles, minHistory, templateHash, issuers: {} });
  if (d.chainId !== chainId || d.deployment !== DEPLOYMENT || d.minHistory !== minHistory ||
      d.templateHash !== templateHash || JSON.stringify(d.roles) !== JSON.stringify(roles))
    throw new Error('Deployment configuration/keys changed; restore the original inputs before resuming');
  const checkpoint = () => writeJson(journal, d, true);
  const ensure = async (field: 'asset' | 'bondImplementation' | 'accountImplementation' | 'covenant' | 'factory' | 'creditRegistry' | 'vault',
    contract: string, args: unknown[] = []) => {
    if (d[field]) {
      if (!await publicClient.getCode({ address: d[field]! })) throw new Error(`Missing deployed code for ${field}; wrong/reset chain`);
    } else { d[field] = await deploy(deployer, contract, args); checkpoint(); }
    return d[field]!;
  };
  console.log(`Deploying/resuming ${DEPLOYMENT} on ${chain.name} (${chainId}) from ${deployer.address}`);
  checkpoint();
  if (chainId === 31337) {
    await ensure('asset', 'MockERC3009');
    // Only top up the local deployer; repeated runs never mint additional balances unnecessarily.
    const abi = artifact('MockERC3009').abi;
    const balance = await publicClient.readContract({ address: d.asset!, abi, functionName: 'balanceOf', args: [deployer.address] }) as bigint;
    if (balance < 1_000_000_000n) await write(deployer, d.asset!, abi, 'mint', [deployer.address, 1_000_000_000n - balance]);
    d.forwarder = deployer.address;
  } else {
    d.asset = TESTNET_USDC;
    d.forwarder = TESTNET_CRE_FORWARDER;
    for (const address of [d.asset, d.forwarder])
      if (!await publicClient.getCode({ address })) throw new Error(`No code at ${address}`);
  }
  for (const [name, target] of Object.entries(gasTargets)) {
    const balance = await publicClient.getBalance({ address: roles[name] });
    if (balance < parseEther(target)) {
      const hash = await wallet(deployer).sendTransaction({ to: roles[name], value: parseEther(target) - balance, gas: 21_000n });
      if ((await publicClient.waitForTransactionReceipt({ hash })).status !== 'success') throw new Error(`Funding ${name} failed`);
    }
  }
  await ensure('bondImplementation', 'BondrailBond');
  await ensure('accountImplementation', 'BondrailAccount');
  await ensure('covenant', 'BondrailCovenant', [d.forwarder, roles.observer]);
  await ensure('factory', 'BondrailFactory', [d.covenant, roles.milestone, d.bondImplementation, d.accountImplementation, roles.reviewer, BigInt(minHistory)]);
  const covenantAbi = artifact('BondrailCovenant').abi;
  const initialized = await publicClient.readContract({ address: d.covenant!, abi: covenantAbi, functionName: 'factory' }) as Address;
  if (/^0x0{40}$/i.test(initialized)) await write(deployer, d.covenant!, covenantAbi, 'initializeFactory', [d.factory]);
  else if (initialized.toLowerCase() !== d.factory!.toLowerCase()) throw new Error('Covenant factory mismatch');
  await ensure('creditRegistry', 'BondrailCreditRegistry', [d.factory, deployer.address, roles.attester]);
  await ensure('vault', 'BondrailVault', [d.asset, d.factory, deployer.address, roles.curator]);
  const factoryAbi = artifact('BondrailFactory').abi;
  if (!await publicClient.readContract({ address: d.factory!, abi: factoryAbi, functionName: 'nativeTemplate', args: [templateHash] }))
    await write(account('reviewer'), d.factory!, factoryAbi, 'setNativeTemplate', [templateHash, true]);
  Object.assign(d, { observer: roles.observer, milestoneSigner: roles.milestone, reviewer: roles.reviewer,
    attester: roles.attester, curator: roles.curator });
  saveDeployment(d as DeploymentFile);
  fs.unlinkSync(journal);
  console.log(`Saved ${deploymentFile}; reviewed PumpLab ${templateHash}; start block ${d.startBlock}`);
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
