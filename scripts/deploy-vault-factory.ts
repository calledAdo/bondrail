// Plan by default. Broadcasting requires --execute and an explicit key directory (never a legacy fallback).
import {
  account, artifact, assertChain, assertDeploymentWritable, chainId, deploy, deploymentFile,
  publicClient, readDeployment, saveDeployment, write,
} from './lib.ts';

async function main() {
  const d = readDeployment();
  const register = process.argv.includes('--register-existing');
  console.log(`Vault factory plan: chain ${chainId}; manifest ${deploymentFile}; protocol ${d.factory}; legacy ${register ? d.vault ?? 'missing' : 'not requested'}`);
  if (!process.argv.includes('--execute')) {
    console.log('Plan only. Add --execute --force to broadcast and update the existing manifest.');
    return;
  }
  assertDeploymentWritable();
  if (!process.env.BONDRAIL_KEY_DIR) throw new Error('Set BONDRAIL_KEY_DIR explicitly; no legacy key-store fallback');
  await assertChain();
  if (register && !d.vault) throw new Error('No existing vault in this manifest');
  const deployer = account('deployer');
  const abi = artifact('BondrailVaultFactory').abi;
  if (!d.vaultFactory) {
    // Start inclusively before deployment; survives a resumed registration and covers every new vault.
    d.vaultFactoryStartBlock = String(await publicClient.getBlockNumber());
    d.vaultFactory = await deploy(deployer, 'BondrailVaultFactory', [d.factory, deployer.address]);
    saveDeployment(d);
  }
  if (!d.vaultFactoryStartBlock) throw new Error('Existing factory has no start block; reconcile manifest before resuming');
  const read = (functionName: string, args: unknown[] = []) => publicClient.readContract({ address: d.vaultFactory!, abi, functionName, args });
  if (String(await read('factory')).toLowerCase() !== d.factory.toLowerCase()) throw new Error('Protocol factory mismatch');
  if (String(await read('owner')).toLowerCase() !== deployer.address.toLowerCase()) throw new Error('Vault factory owner mismatch');
  if (register && !await read('isVault', [d.vault])) {
    if (await read('existingRegistered')) throw new Error('One-time registration already used for another vault');
    await write(deployer, d.vaultFactory, abi, 'registerExisting', [d.vault]);
  }
  console.log(`Saved vaultFactory ${d.vaultFactory}, start block ${d.vaultFactoryStartBlock}; registration ${register ? 'verified' : 'not requested'}`);
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
