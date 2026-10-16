// Read-only preflight: every RPC request is eth_call. No keys, wallets or manifest writes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { createPublicClient, decodeAbiParameters, decodeErrorResult, encodeDeployData, encodeFunctionData,
  getContractAddress, http, isAddress, keccak256, parseAbi, type Abi, type Address, type Hex } from 'viem';
import type { DeploymentFile } from './lib.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const getters = parseAbi(['function asset() view returns (address)', 'function factory() view returns (address)',
  'function owner() view returns (address)', 'function curator() view returns (address)']);
const registryAbi = parseAbi(['function registerExisting(address)', 'error Unauthorized()', 'error InvalidConfiguration()',
  'error InvalidVault()', 'error AlreadyRegistered()']);
function artifact(source: string, name = source) {
  return JSON.parse(fs.readFileSync(path.join(root, 'contracts/out', `${source}.sol`, `${name}.json`), 'utf8')) as {
    abi: Abi; bytecode: { object: Hex }; deployedBytecode: { object: Hex };
  };
}
function requiredAddress(value: unknown, field: string): Address {
  if (typeof value !== 'string' || !isAddress(value) || /^0x0{40}$/i.test(value)) throw new Error(`Manifest requires ${field}`);
  return value;
}

export async function checkVaultRegistration(rpc: string, manifest: DeploymentFile) {
  const vault = requiredAddress(manifest.vault, 'vault');
  const factory = requiredAddress(manifest.vaultFactory, 'vaultFactory');
  const protocol = requiredAddress(manifest.factory, 'factory');
  const operator = requiredAddress(manifest.deployer ?? manifest.roles?.deployer, 'deployer (operator)');
  const client = createPublicClient({ transport: http(rpc, { retryCount: 0 }) });
  const call = (data: Hex, to?: Address, block: Hex | 'latest' = 'latest') =>
    client.request({ method: 'eth_call', params: [{ from: operator, ...(to ? { to } : {}), data }, block] });
  // Creation-call initcode returns CHAINID and NUMBER without deploying a contract.
  const [chainId, blockNumber] = decodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }],
    await call('0x466000524360205260406000f3'));
  if (chainId !== BigInt(manifest.chainId)) throw new Error('RPC chain ID does not match manifest');
  const block = `0x${blockNumber.toString(16)}` as Hex;
  const readAddress = async (to: Address, functionName: 'asset' | 'factory' | 'owner' | 'curator') =>
    decodeAbiParameters([{ type: 'address' }], await call(encodeFunctionData({ abi: getters, functionName }), to, block))[0];
  // PUSH20 address; DUP1 EXTCODESIZE DUP1 PUSH1 0 PUSH1 0 DUP5 EXTCODECOPY PUSH1 0 RETURN.
  // This creation eth_call returns another account's runtime, avoiding even eth_getCode.
  const runtime = (address: Address) => call(`0x73${address.slice(2)}803b8060006000843c6000f3`, undefined, block);
  const [asset, owner, curator, candidateProtocol, registryProtocol, registryOwner, candidateCode] = await Promise.all([
    readAddress(vault, 'asset'), readAddress(vault, 'owner'), readAddress(vault, 'curator'), readAddress(vault, 'factory'),
    readAddress(factory, 'factory'), readAddress(factory, 'owner'), runtime(vault),
  ]);
  if ([candidateProtocol, registryProtocol].some(a => a.toLowerCase() !== protocol.toLowerCase())) throw new Error('Protocol factory mismatch');
  if (registryOwner.toLowerCase() !== operator.toLowerCase()) throw new Error('Manifest operator is not the vault factory owner');
  // The factory's first CREATE is its immutable legacy verifier. Verify its complete runtime
  // before trusting the local reference build; the verifier embeds that exact vault initcode.
  const verifier = getContractAddress({ from: factory, nonce: 1n });
  const verifierArtifact = artifact('BondrailVaultFactory', 'BondrailLegacyVaultVerifier');
  if (keccak256(await runtime(verifier)) !== keccak256(verifierArtifact.deployedBytecode.object)) {
    throw new Error('Deployed verifier differs from local build. Rebuild the exact factory revision/settings before comparing vault hashes.');
  }
  const reference = artifact('BondrailVault');
  const referenceCode = await call(encodeDeployData({ abi: reference.abi, bytecode: reference.bytecode.object,
    args: [asset, protocol, owner, curator] }), undefined, block);
  const candidateCodeHash = keccak256(candidateCode), referenceCodeHash = keccak256(referenceCode);
  let simulation: string = 'PASS';
  try {
    await call(encodeFunctionData({ abi: registryAbi, functionName: 'registerExisting', args: [vault] }), factory, block);
  } catch (error) {
    // RPC errors wrap revert bytes at varying depths; preserve a named reason when available.
    let cause: unknown = error;
    simulation = 'RPC error or revert (registration not verified)';
    for (let i = 0; cause && typeof cause === 'object' && i < 10; i++) {
      const e = cause as { data?: unknown; cause?: unknown; shortMessage?: string };
      if (e.shortMessage) simulation = e.shortMessage;
      if (typeof e.data === 'string') {
        try { simulation = decodeErrorResult({ abi: registryAbi, data: e.data as Hex }).errorName; break; } catch { /* provider wrapper */ }
      }
      cause = e.cause;
    }
  }
  const match = candidateCodeHash === referenceCodeHash;
  return { chainId: Number(chainId), block: blockNumber.toString(), vault, factory, operator, verifier,
    candidateCodeHash, referenceCodeHash, code: match ? 'MATCH' : 'MISMATCH', simulation, ready: match && simulation === 'PASS' };
}

async function main() {
  const { values } = parseArgs({ options: { rpc: { type: 'string' }, manifest: { type: 'string' } }, strict: true });
  if (!values.rpc || !values.manifest) throw new Error('Usage: pnpm tsx scripts/check-vault-registration.ts --rpc <URL> --manifest <path>');
  const result = await checkVaultRegistration(values.rpc, JSON.parse(fs.readFileSync(values.manifest, 'utf8')) as DeploymentFile);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ready) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
