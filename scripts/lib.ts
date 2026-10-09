// Shared helpers for Slice operational scripts: chains, keys, clients, forge artifacts, deployments.
// Keys live outside the repo in ~/.slice (chmod 600) and are never printed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createPublicClient,
  createWalletClient,
  http,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { monadTestnet, sliceLocal } from '../packages/shared/src/index.ts';

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
export const KEY_DIR = process.env.SLICE_KEY_DIR ?? path.join(os.homedir(), '.slice');

export const chainId = Number(process.env.SLICE_CHAIN_ID ?? 10143) as 10143 | 31337;
if (chainId !== 10143 && chainId !== 31337) throw new Error('Slice scripts write to local 31337 or Monad testnet 10143 only');
export const chain = chainId === 31337 ? sliceLocal : monadTestnet;
export const rpcUrl = process.env.SLICE_RPC_URL ?? chain.rpcUrls.default.http[0];

/** Monad bills the gas limit, not gas used: estimate and add 20%, never a blanket large limit. */
export const publicClient: PublicClient = createPublicClient({
  chain,
  transport: http(rpcUrl, { batch: { wait: 16 }, retryCount: 4 }),
});

const ANVIL_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

/** Load ~/.slice/<name>.key, creating it (0600) when `create` is set. Local chain uses anvil's key for the deployer. */
export function key(name: string, opts: { create?: boolean; fallbackFile?: string } = {}): Hex {
  if (chainId === 31337 && name === 'deployer') return ANVIL_KEY;
  const file = path.join(KEY_DIR, `${name}.key`);
  if (!fs.existsSync(file) && opts.fallbackFile && fs.existsSync(opts.fallbackFile))
    return normalize(fs.readFileSync(opts.fallbackFile, 'utf8'));
  if (!fs.existsSync(file)) {
    if (!opts.create) throw new Error(`Missing key ${file}`);
    fs.mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, generatePrivateKey() + '\n', { mode: 0o600 });
  }
  return normalize(fs.readFileSync(file, 'utf8'));
}
const normalize = (s: string) => {
  const t = s.trim();
  return (t.startsWith('0x') ? t : `0x${t}`) as Hex;
};

export function account(name: string, opts?: Parameters<typeof key>[1]): PrivateKeyAccount {
  return privateKeyToAccount(key(name, opts));
}

export function wallet(acct: PrivateKeyAccount) {
  return createWalletClient({ account: acct, chain, transport: http(rpcUrl) });
}

export function artifact(name: string): { abi: Abi; bytecode: Hex } {
  const file = path.join(ROOT, 'contracts/out', `${name}.sol`, `${name}.json`);
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { abi: j.abi, bytecode: j.bytecode.object };
}

export async function deploy(
  acct: PrivateKeyAccount,
  name: string,
  args: unknown[] = [],
): Promise<Address> {
  const { abi, bytecode } = artifact(name);
  const w = wallet(acct);
  const gas = await publicClient.estimateGas({
    account: acct,
    data: (await import('viem')).encodeDeployData({ abi, bytecode, args }),
  });
  const hash = await w.deployContract({ abi, bytecode, args, gas: (gas * 12n) / 10n });
  const r = await publicClient.waitForTransactionReceipt({ hash });
  if (r.status !== 'success' || !r.contractAddress) throw new Error(`${name} deployment failed (${hash})`);
  console.log(`  ${name.padEnd(16)} ${r.contractAddress}`);
  return r.contractAddress;
}

/** Simulate, send with a 20%-padded gas limit, wait for the receipt, throw on revert. */
export async function write(
  acct: PrivateKeyAccount,
  address: Address,
  abi: Abi,
  functionName: string,
  args: unknown[] = [],
) {
  const { request } = await publicClient.simulateContract({ account: acct, address, abi, functionName, args });
  const gas = await publicClient.estimateContractGas({ account: acct, address, abi, functionName, args });
  const hash = await wallet(acct).writeContract({ ...request, gas: (gas * 12n) / 10n } as never);
  const r = await publicClient.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error(`${functionName} reverted (${hash})`);
  return r;
}

export const deploymentFile = path.join(ROOT, 'docs/deployments', `${chainId}.json`);
export type DeploymentFile = {
  schemaVersion: 1;
  chainId: number;
  network: string;
  deployedAt: string;
  startBlock: string;
  asset: Address;
  factory: Address;
  covenant: Address;
  forwarder: Address;
  observer: Address;
  milestoneSigner: Address;
  bondImplementation: Address;
  routerImplementation: Address;
  issuers: Record<
    string,
    {
      name: string;
      issuer: Address;
      router: Address;
      bond?: Address;
      source?: Address;
      guard?: Address;
      token?: Address;
      endpoint?: string;
      agentId?: string;
    }
  >;
};
export function readDeployment(): DeploymentFile {
  return JSON.parse(fs.readFileSync(deploymentFile, 'utf8'));
}
export function saveDeployment(d: DeploymentFile) {
  fs.mkdirSync(path.dirname(deploymentFile), { recursive: true });
  fs.writeFileSync(deploymentFile, JSON.stringify(d, null, 2) + '\n');
}
