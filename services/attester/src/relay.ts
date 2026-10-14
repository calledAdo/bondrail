import type { Account, Address, Chain, Hex, PublicClient, Transport, WalletClient } from 'viem';
import { bondrailCreditRegistryAbi, bondrailFactoryAbi } from '@bondrail/sdk/abis';
import type { CreditAttestation } from '@bondrail/sdk/credit';

type Reader = Pick<PublicClient, 'getBlockNumber' | 'readContract' | 'getContractEvents' | 'simulateContract' | 'waitForTransactionReceipt'>;
type Writer = Pick<WalletClient<Transport, Chain, Account>, 'account' | 'writeContract'>;

/** Confirm all missing registrations before attesting. A failed/incomplete backfill never attests. */
export async function relayAttestation(client: Reader, wallet: Writer, registry: Address,
  attestation: CreditAttestation, signature: Hex, factoryStartBlock = 0n) {
  const blockNumber = await client.getBlockNumber();
  if (factoryStartBlock < 0n || factoryStartBlock > blockNumber) throw new Error('Invalid FACTORY_START_BLOCK');
  const base = { address: registry, abi: bondrailCreditRegistryAbi } as const;
  const [current, factory, limit, profile] = await Promise.all([
    client.readContract({ ...base, functionName: 'attester', blockNumber }),
    client.readContract({ ...base, functionName: 'factory', blockNumber }),
    client.readContract({ ...base, functionName: 'MAX_BONDS', blockNumber }),
    client.readContract({ ...base, functionName: 'onchainProfile', args: [attestation.account], blockNumber }),
  ]);
  if (current.toLowerCase() !== wallet.account.address.toLowerCase()) throw new Error('Signing key is not the registry attester');
  if (profile.bondsCreated > limit) throw new Error('Cannot attest: account exceeds the registry bond limit; repayment record is incomplete');
  const recordedHashes: Hex[] = [];
  if (!profile.complete) {
    // The factory counter detects missing RPC events, a late start block or truncated scans.
    const bonds = new Set<Address>();
    for (let fromBlock = factoryStartBlock; fromBlock <= blockNumber; fromBlock += 10_000n) {
      const toBlock = fromBlock + 9_999n < blockNumber ? fromBlock + 9_999n : blockNumber;
      const logs = await client.getContractEvents({ address: factory, abi: bondrailFactoryAbi,
        eventName: 'BondCreated', args: { account: attestation.account }, fromBlock, toBlock, strict: true });
      for (const log of logs) bonds.add(log.args.bond.toLowerCase() as Address);
    }
    if (BigInt(bonds.size) !== profile.bondsCreated) throw new Error('Factory bond events do not reconcile to bondsCreated; check RPC coverage and FACTORY_START_BLOCK');
    for (const bond of bonds) {
      if (await client.readContract({ ...base, functionName: 'recorded', args: [bond] })) continue;
      const { request } = await client.simulateContract({ ...base, functionName: 'recordBond', args: [bond], account: wallet.account });
      const hash = await wallet.writeContract(request);
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error(`Record bond reverted: ${hash}`);
      recordedHashes.push(hash);
    }
  }
  // Recheck after confirmations: new issuance during backfill must not go unnoticed.
  const after = await client.readContract({ ...base, functionName: 'onchainProfile', args: [attestation.account] });
  if (!after.complete) throw new Error('Repayment record is still incomplete; retry before attesting');
  const { request } = await client.simulateContract({ ...base, functionName: 'attest', args: [attestation, signature], account: wallet.account });
  const hash = await wallet.writeContract(request);
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`Attest reverted: ${hash}`);
  return { hash, recordedHashes };
}
