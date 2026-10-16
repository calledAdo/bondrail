// Local Anvil log adapter. RPC supplies logs/headers only; vault accounting never reads chain state.
import { bondrailVaultAbi, bondrailVaultFactoryAbi } from '../packages/sdk/src/abis.ts';
import { ZERO, emptyTotals, emptyPrice, eventTotals, eventPrice, addTotals, supplyChange, emptyHolding, updateHolding } from '../indexer/src/vault-accounting.ts';
import { type PublicClient } from 'viem';
import type { DeploymentFile } from './lib.ts';
const low = (a: string) => a.toLowerCase();
export async function localVaultIndex(client: PublicClient, d: DeploymentFile) {
  if (d.chainId !== 31337) throw new Error('Local vault index is Anvil only');
  const latest = await client.getBlock();
  const registered = d.vaultFactory ? await client.getContractEvents({ address: d.vaultFactory, abi: bondrailVaultFactoryAbi,
    eventName: 'VaultCreated', fromBlock: 0n, toBlock: latest.number, strict: true }) : [];
  const addresses = [...new Set([...registered.map(e => e.args.vault), ...d.vault ? [d.vault] : []]
    .map(a => low(a) as `0x${string}`))];
  const Vault: any[] = [], VaultDailySnapshot: any[] = [], VaultActivity: any[] = [];
  const positions = new Map<string, { id: string; vault: string; holder: string; shares: bigint; costBasis: bigint; deposited: bigint; withdrawn: bigint }>();
  const holdings = new Map<string, ReturnType<typeof emptyHolding>>();
  const times = new Map<bigint, bigint>([[latest.number, latest.timestamp]]);
  const time = async (blockNumber: bigint) => {
    if (!times.has(blockNumber)) times.set(blockNumber, (await client.getBlock({ blockNumber })).timestamp);
    return times.get(blockNumber)!;
  };
  for (const address of addresses) {
    const vault = low(address), byDay = new Map<number, any>();
    const registration = registered.find(e => low(e.args.vault) === vault);
    const p = registration?.args;
    let v = { id: vault, chainId: 31337, registry: registration ? low(registration.address) : '', asset: p ? low(p.asset) : undefined,
      curator: p ? low(p.curator) : undefined, owner: p ? low(p.owner) : undefined, name: p?.name, symbol: p?.symbol,
      strategy: p?.strategy.description, metadataHash: p?.strategy.metadataHash, createdAt: 0n,
      pendingCurator: undefined as string | undefined, curatorChangeAfter: undefined as bigint | undefined,
      ...emptyTotals(), ...emptyPrice(), totalSupply: 0n, lockedIncome: 0n, holdings: [] as string[] };
    const position = (holder: string) => positions.get(`${vault}-${holder}`) ?? { id: `${vault}-${holder}`, vault, holder, shares: 0n, costBasis: 0n, deposited: 0n, withdrawn: 0n };
    const logs = await client.getContractEvents({ address, abi: bondrailVaultAbi, fromBlock: 0n, toBlock: latest.number, strict: true });
    v.createdAt = logs.length ? await time(logs[0].blockNumber) : registration ? await time(registration.blockNumber) : latest.timestamp;
    for (const e of logs) {
      if (!['Transfer', 'Deposit', 'Withdraw', 'Allocated', 'Collected', 'RaiseWithdrawn', 'IncomeCheckpointed', 'CuratorProposed', 'CuratorChanged'].includes(e.eventName)) continue;
      const timestamp = await time(e.blockNumber), day = Number(timestamp / 86400n);
      if (e.eventName === 'Transfer') {
        const from = low(e.args.from), to = low(e.args.to), shares = e.args.value;
        if (from !== to) {
          let cost = 0n;
          if (from !== ZERO) {
            const p = position(from);
            if (shares > p.shares) throw new Error('Incomplete local share history');
            cost = p.shares ? p.costBasis * shares / p.shares : 0n;
            positions.set(p.id, { ...p, shares: p.shares - shares, costBasis: p.costBasis - cost });
          }
          if (to !== ZERO) { const p = position(to); positions.set(p.id, { ...p, shares: p.shares + shares, costBasis: p.costBasis + cost }); }
        }
      } else if (e.eventName === 'Deposit' || e.eventName === 'Withdraw') {
        const p = position(low(e.args.owner));
        positions.set(p.id, e.eventName === 'Deposit' ? { ...p, costBasis: p.costBasis + e.args.assets, deposited: p.deposited + e.args.assets }
          : { ...p, withdrawn: p.withdrawn + e.args.assets });
      }
      const args = e.args as Record<string, any>;
      const ev = { kind: e.eventName, timestamp, assets: args.assets ?? args.newIncome ?? 0n, shares: args.shares ?? args.value ?? args.claims ?? 0n,
        from: low(args.from ?? ''), to: low(args.to ?? ''), newIncome: args.newIncome, lockedIncome: args.lockedIncome };
      const price = eventPrice(ev), delta = eventTotals(ev);
      v = { ...addTotals(v, delta), ...price, totalSupply: v.totalSupply + supplyChange(ev), lockedIncome: ev.lockedIncome ?? v.lockedIncome };
      if (args.bond) {
        const bond = low(args.bond), id = `${vault}-${bond}`;
        const h = updateHolding(holdings.get(id) ?? emptyHolding(vault, bond), ev.kind, ev.assets);
        holdings.set(id, h);
        v.holdings = h.active ? [...new Set([...v.holdings, bond])] : v.holdings.filter(b => b !== bond);
      }
      if (e.eventName === 'CuratorProposed') { v.pendingCurator = low(e.args.curator); v.curatorChangeAfter = e.args.executableAt; }
      if (e.eventName === 'CuratorChanged') { v.curator = low(e.args.curator); v.pendingCurator = undefined; v.curatorChangeAfter = undefined; }
      const daily = byDay.get(day) ?? { id: `${vault}-${day}`, vault, day, ...emptyTotals(), ...emptyPrice(), eventCount: 0 };
      byDay.set(day, { ...addTotals(daily, delta), ...price, timestamp, block: e.blockNumber,
        eventCount: daily.eventCount + 1, totalSupply: v.totalSupply, lockedIncome: v.lockedIncome });
      VaultActivity.push({ id: `31337:${e.blockNumber}:${e.transactionHash}:${e.logIndex}`, chainId: 31337, vault, kind: e.eventName,
        actor: low(args.from ?? args.owner ?? args.curator ?? args.sender ?? ''), receiver: low(args.to ?? args.receiver ?? args.previousCurator ?? ''), bond: low(args.bond ?? ''),
        assets: ev.assets, shares: ev.shares, realizedPrice: price?.realizedPrice, lockedIncome: ev.lockedIncome,
        timestamp, block: e.blockNumber, txHash: e.transactionHash });
    }
    Vault.push(v);
    VaultDailySnapshot.push(...byDay.values());
  }
  const result = { Vault, VaultDailySnapshot, VaultActivity, VaultHolding: [...holdings.values()], VaultPosition: [...positions.values()] };
  // Match GraphQL's BigInt strings and nullable fields.
  return JSON.parse(JSON.stringify(result, (_, v) => typeof v === 'bigint' ? String(v) : v === undefined ? null : v)) as {
    Vault: any[]; VaultDailySnapshot: any[]; VaultActivity: any[]; VaultHolding: any[]; VaultPosition: any[];
  };
}
