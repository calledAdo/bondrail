// Local Anvil adapter only. Builds the same vault entities from real logs + historical eth_call.
import { getVault } from '../packages/sdk/src/vault.ts';
import { bondrailVaultAbi, bondrailVaultFactoryAbi } from '../packages/sdk/src/abis.ts';
import { type Address, type PublicClient } from 'viem';
import type { DeploymentFile } from './lib.ts';
const ZERO = '0x0000000000000000000000000000000000000000';
const low = (a: string) => a.toLowerCase();
export async function localVaultIndex(client: PublicClient, d: DeploymentFile) {
  if (d.chainId !== 31337) throw new Error('Local vault index is Anvil only');
  const latest = await client.getBlock();
  const addresses = d.vaultFactory ? await client.readContract({ address: d.vaultFactory, abi: bondrailVaultFactoryAbi,
    functionName: 'vaults', args: [0n, 100n] }) : d.vault ? [d.vault] : [];
  const Vault: any[] = [], VaultDailySnapshot: any[] = [], VaultActivity: any[] = [];
  const positions = new Map<string, { id: string; vault: string; holder: string; shares: bigint; costBasis: bigint; deposited: bigint; withdrawn: bigint }>();
  const times = new Map<bigint, bigint>([[latest.number, latest.timestamp]]);
  const time = async (blockNumber: bigint) => {
    if (!times.has(blockNumber)) times.set(blockNumber, (await client.getBlock({ blockNumber })).timestamp);
    return times.get(blockNumber)!;
  };
  for (const address of addresses) {
    const vault = low(address), byDay = new Map<number, { block: bigint; timestamp: bigint }>();
    const position = (holder: string) => positions.get(`${vault}-${holder}`) ?? { id: `${vault}-${holder}`, vault, holder, shares: 0n, costBasis: 0n, deposited: 0n, withdrawn: 0n };
    const logs = await client.getContractEvents({ address, abi: bondrailVaultAbi, fromBlock: 0n, toBlock: latest.number, strict: true });
    for (const e of logs) {
      const timestamp = await time(e.blockNumber);
      byDay.set(Number(timestamp / 86400n), { block: e.blockNumber, timestamp });
      if (e.eventName === 'Transfer') {
        const from = low(e.args.from), to = low(e.args.to), shares = e.args.value;
        if (from === to) continue;
        let cost = 0n;
        if (from !== ZERO) {
          const p = position(from);
          if (shares > p.shares) throw new Error('Incomplete local share history');
          cost = p.shares ? p.costBasis * shares / p.shares : 0n;
          positions.set(p.id, { ...p, shares: p.shares - shares, costBasis: p.costBasis - cost });
        }
        if (to !== ZERO) { const p = position(to); positions.set(p.id, { ...p, shares: p.shares + shares, costBasis: p.costBasis + cost }); }
      } else if (e.eventName === 'Deposit' || e.eventName === 'Withdraw') {
        const p = position(low(e.args.owner));
        positions.set(p.id, e.eventName === 'Deposit' ? { ...p, costBasis: p.costBasis + e.args.assets, deposited: p.deposited + e.args.assets }
          : { ...p, withdrawn: p.withdrawn + e.args.assets });
      }
      if (e.eventName !== 'Transfer' && e.eventName !== 'Approval') {
        const args = e.args as Record<string, unknown>;
        VaultActivity.push({ id: `31337:${e.blockNumber}:${e.transactionHash}:${e.logIndex}`, chainId: 31337, vault, kind: e.eventName,
          actor: String(args.owner ?? args.curator ?? ''), receiver: String(args.receiver ?? ''), bond: String(args.bond ?? ''),
          assets: String(args.assets ?? args.newIncome ?? 0), shares: String(args.shares ?? args.claims ?? 0),
          timestamp: String(timestamp), block: String(e.blockNumber), txHash: e.transactionHash });
      }
    }
    byDay.set(Number(latest.timestamp / 86400n), { block: latest.number, timestamp: latest.timestamp });
    for (const [day, at] of byDay) {
      const v = await getVault(client, address, { blockNumber: at.block, registry: at.block === latest.number ? d.vaultFactory : undefined });
      VaultDailySnapshot.push({ id: `${vault}-${day}`, vault, day, timestamp: String(at.timestamp), block: String(at.block),
        entryPrice: String(v.entryPrice), exitPrice: String(v.exitPrice), nav: String(v.nav), entryNav: String(v.entryNav), idle: String(v.idle), totalSupply: String(v.supply) });
      if (at.block === latest.number) Vault.push({ id: vault, chainId: 31337, registry: low(d.vaultFactory ?? ZERO), asset: low(v.asset),
        curator: low(v.curator), owner: low(v.owner), name: v.name, symbol: v.symbol,
        strategy: v.strategy?.description ?? 'Diversified revenue bonds under fixed allocation limits', metadataHash: v.strategy?.metadataHash ?? '', createdAt: String(logs.length ? await time(logs[0].blockNumber) : latest.timestamp) });
    }
  }
  return { Vault, VaultDailySnapshot, VaultActivity, VaultPosition: [...positions.values()].map(p => ({ ...p, shares: String(p.shares), costBasis: String(p.costBasis), deposited: String(p.deposited), withdrawn: String(p.withdrawn) })) };
}
