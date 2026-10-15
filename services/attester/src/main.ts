import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, defineChain, isAddress, type Hex } from 'viem';
import { createRpcTransport, rpcUrlsFromEnv } from '@bondrail/shared';
import { privateKeyToAccount } from 'viem/accounts';
import { creditAttestationDomain, creditAttestationTypes } from '@bondrail/sdk/credit';
import { buildAttestation, readIndexedInputs, type CreditInputs } from './attestation.ts';
import { relayAttestation } from './relay.ts';

const json = (v: unknown) => JSON.stringify(v, (_, value) => typeof value === 'bigint' ? String(value) : value, 2);
async function main() {
  const args = process.argv.slice(2);
  let relay = false;
  let fixture: string | undefined;
  for (let i = 0; i < args.length; ++i) {
    if (args[i] === '--relay') relay = true;
    else if (args[i] === '--fixture' && args[i + 1]) fixture = args[++i];
    else throw new Error('usage: start [--fixture path] [--relay]');
  }
  if (fixture && relay) throw new Error('Fixture mode is dry-run only');
  const urls = rpcUrlsFromEnv(process.env.RPC_URL);
  const transport = urls.length ? createRpcTransport(urls) : undefined;
  const chainId = Number(process.env.CHAIN_ID ?? '10143');
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error('Invalid CHAIN_ID');
  const chain = defineChain({ id: chainId, name: 'Credit registry network', nativeCurrency: { name: 'Gas', symbol: 'GAS', decimals: 18 },
    rpcUrls: { default: { http: urls } } });
  const client = transport ? createPublicClient({ chain, transport }) : undefined;
  let inputs: CreditInputs;
  let issuedAt: number;
  if (fixture) {
    inputs = JSON.parse(await readFile(fixture, 'utf8')) as CreditInputs;
    issuedAt = inputs.periodEnd;
  } else {
    const registry = process.env.CREDIT_REGISTRY_ADDRESS;
    const account = process.env.CREDIT_ACCOUNT;
    if (!client || !registry || !account || !isAddress(registry) || !isAddress(account) || !process.env.INDEXER_URL)
      throw new Error('Set RPC_URL, INDEXER_URL, CREDIT_REGISTRY_ADDRESS and CREDIT_ACCOUNT');
    if (await client.getChainId() !== chainId) throw new Error('RPC chain mismatch');
    const block = await client.getBlock();
    issuedAt = Number(block.timestamp);
    inputs = await readIndexedInputs({ url: process.env.INDEXER_URL, adminSecret: process.env.INDEXER_ADMIN_SECRET },
      { account, registry, chainId, periodEnd: issuedAt });
    const after = await client.getBlock();
    const observedAt = Number(after.timestamp);
    if (Math.floor(observedAt / 86_400) !== Math.floor(issuedAt / 86_400))
      throw new Error('UTC day changed during snapshot; retry');
    // Lifetime aggregates were read after the first block. End their observation window
    // at the subsequent chain time, so newly indexed payments are not assigned an earlier cutoff.
    inputs.periodEnd = observedAt;
    issuedAt = observedAt;
  }
  const ttl = Number(process.env.ATTESTATION_TTL_SECONDS ?? '86400');
  if (!Number.isSafeInteger(ttl) || ttl <= 0) throw new Error('Invalid attestation TTL');
  const nonce = !process.env.ATTESTATION_NONCE ? BigInt(`0x${randomBytes(32).toString('hex')}`) : BigInt(process.env.ATTESTATION_NONCE);
  const result = buildAttestation(inputs, { issuedAt, expiresAt: issuedAt + ttl, nonce });
  const directory = process.env.ATTESTATION_EVIDENCE_DIR ?? fileURLToPath(new URL('../../../docs/credit/evidence/', import.meta.url));
  await mkdir(directory, { recursive: true });
  const evidencePath = path.join(directory, `${result.attestation.evidenceHash}.json`);
  await writeFile(evidencePath, result.evidence); // exact bytes hashed; no newline
  const key = process.env.ATTESTER_PRIVATE_KEY;
  if (key && !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error('Invalid ATTESTER_PRIVATE_KEY');
  const signer = key ? privateKeyToAccount(key as Hex) : undefined;
  const signature = signer ? await signer.signTypedData({ domain: creditAttestationDomain(inputs.chainId, inputs.registry),
    types: creditAttestationTypes, primaryType: 'CreditAttestation', message: result.attestation }) : undefined;
  if (!relay) {
    console.log(json({ mode: 'dry-run', signer: signer?.address ?? null, signature: signature ?? null,
      attestation: result.attestation, evidencePath }));
    return;
  }
  if (!client || !signer || !signature) throw new Error('--relay requires RPC_URL and ATTESTER_PRIVATE_KEY');
  const wallet = createWalletClient({ account: signer, chain, transport: transport! });
  const { hash, recordedHashes } = await relayAttestation(client, wallet, inputs.registry,
    result.attestation, signature, BigInt(process.env.FACTORY_START_BLOCK ?? '0'));
  console.log(json({ mode: 'relayed', hash, recordedHashes, signer: signer.address, evidencePath }));
}
main().catch((error) => {
  // viem errors can embed the signed payload or provider URLs. Do not print those details.
  console.error(error?.name === 'Error' ? error.message : 'Attester failed; check configuration and RPC/indexer availability');
  process.exitCode = 1;
});
