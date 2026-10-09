// Deploys the Slice core: bond + router implementations, SliceCovenant (CRE receiver), SliceFactory.
//   SLICE_CHAIN_ID=31337 pnpm tsx scripts/deploy.ts     local anvil (deploys MockUSDC too)
//   pnpm tsx scripts/deploy.ts                          Monad testnet (Circle test USDC, CRE mock forwarder)
// Writes docs/deployments/<chainId>.json. Demo issuers are set up separately by scripts/setup-demo.ts.
import os from 'node:os';
import path from 'node:path';
import { parseAbi, type Address } from 'viem';
import { account, chain, chainId, deploy, publicClient, saveDeployment, write } from './lib.ts';

// Monad testnet: Circle's test USDC (EIP-3009, what the x402 facilitator settles) and the
// Chainlink CRE MockKeystoneForwarder that `cre workflow simulate --broadcast` writes through.
const TESTNET_USDC: Address = '0x534b2f3A21130d7a60830c2Df862319e593943A3';
const TESTNET_CRE_FORWARDER: Address = '0xB9F79d863261869B234c481D1f9A7af84AeAd192';

const deployer = account('deployer', {
  fallbackFile: path.join(os.homedir(), '.zeitgeist/testnet-deployer.key'),
});
// Signing keys: the observer signs payTo observations carried inside CRE reports; the milestone
// signer attests second-release evidence. Both are generated once and kept in ~/.slice.
const observer = account('observer', { create: true });
const milestone = account('milestone', { create: true });

async function main() {
  console.log(`Deploying Slice to ${chain.name} (${chainId}) from ${deployer.address}`);
  const startBlock = await publicClient.getBlockNumber();

  let asset: Address;
  let forwarder: Address;
  if (chainId === 31337) {
    asset = await deploy(deployer, 'MockUSDC');
    await write(deployer, asset, parseAbi(['function mint(address,uint256)']), 'mint', [
      deployer.address,
      1_000_000n * 10n ** 6n,
    ]);
    forwarder = deployer.address; // local: the deployer stands in for the CRE forwarder
  } else {
    asset = TESTNET_USDC;
    forwarder = TESTNET_CRE_FORWARDER;
    for (const a of [asset, forwarder])
      if (!(await publicClient.getCode({ address: a }))) throw new Error(`No code at ${a} on ${chain.name}`);
  }

  const bondImplementation = await deploy(deployer, 'SliceBond');
  const routerImplementation = await deploy(deployer, 'SliceRouter');
  const covenant = await deploy(deployer, 'SliceCovenant', [forwarder, observer.address]);
  const factory = await deploy(deployer, 'SliceFactory', [
    asset,
    covenant,
    milestone.address,
    bondImplementation,
    routerImplementation,
  ]);
  await write(deployer, covenant, parseAbi(['function initializeFactory(address)']), 'initializeFactory', [
    factory,
  ]);

  saveDeployment({
    schemaVersion: 1,
    chainId,
    network: chain.name,
    deployedAt: new Date().toISOString(),
    startBlock: startBlock.toString(),
    asset,
    factory,
    covenant,
    forwarder,
    observer: observer.address,
    milestoneSigner: milestone.address,
    bondImplementation,
    routerImplementation,
    issuers: {},
  });
  console.log(`Saved docs/deployments/${chainId}.json (start block ${startBlock})`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
