import { indexer, type EvmOnEventContext, type EvmEvent } from 'envio';
import { ZERO, emptyTotals, emptyPrice, eventTotals, eventPrice, addTotals, supplyChange, emptyHolding, updateHolding } from '../vault-accounting';
const low = (a: string) => a.toLowerCase();
type Context = EvmOnEventContext;
type Event = EvmEvent<'BondrailVault'>;

indexer.contractRegister({ contract: 'BondrailVaultFactory', event: 'VaultCreated' }, async ({ event, context }) => {
  context.chain.BondrailVault.add(event.params.vault);
});

async function getVault(context: Context, id: string, chainId: number, timestamp: bigint) {
  return await context.Vault.get(id) ?? { id, chainId, registry: '', asset: undefined, owner: undefined,
    curator: undefined, name: undefined, symbol: undefined, strategy: undefined, metadataHash: undefined,
    pendingCurator: undefined, curatorChangeAfter: undefined, createdAt: timestamp,
    ...emptyTotals(), ...emptyPrice(), totalSupply: 0n, lockedIncome: 0n, holdings: [] as string[] };
}

indexer.onEvent({ contract: 'BondrailVaultFactory', event: 'VaultCreated' }, async ({ event, context }) => {
  const p = event.params, vault = low(p.vault);
  const old = await getVault(context, vault, event.chainId, BigInt(event.block.timestamp));
  context.Vault.set({ ...old, registry: low(event.srcAddress), asset: low(p.asset),
    owner: low(p.owner), curator: low(p.curator), name: p.name, symbol: p.symbol,
    strategy: p.strategy.description, metadataHash: p.strategy.metadataHash });
});

function position(vault: string, holder: string) {
  return { id: `${vault}-${holder}`, vault, holder, shares: 0n, costBasis: 0n, deposited: 0n, withdrawn: 0n };
}

indexer.onEvent({ contract: 'BondrailVault', event: 'Transfer' }, async ({ event, context }) => {
  const vault = low(event.srcAddress), from = low(event.params.from), to = low(event.params.to), shares = event.params.value;
  if (from !== to) {
    let cost = 0n;
    if (from !== ZERO) {
      const p = await context.VaultPosition.get(`${vault}-${from}`) ?? position(vault, from);
      if (shares > p.shares) throw new Error('Vault share history incomplete; reindex from deployment');
      cost = p.shares === 0n ? 0n : p.costBasis * shares / p.shares;
      context.VaultPosition.set({ ...p, shares: p.shares - shares, costBasis: p.costBasis - cost });
    }
    if (to !== ZERO) {
      const p = await context.VaultPosition.get(`${vault}-${to}`) ?? position(vault, to);
      context.VaultPosition.set({ ...p, shares: p.shares + shares, costBasis: p.costBasis + cost });
    }
  }
  await activity(context, event, 'Transfer', from, to, '', 0n, shares);
});

async function activity(context: Context, event: Event, kind: string, actor = '', receiver = '', bond = '', assets = 0n, shares = 0n, lockedIncome?: bigint) {
  const vault = low(event.srcAddress), timestamp = BigInt(event.block.timestamp), day = Number(timestamp / 86400n);
  const e = { kind, timestamp, assets, shares, from: low(actor), to: low(receiver), newIncome: assets, lockedIncome };
  const price = eventPrice(e), delta = eventTotals(e);
  let v = addTotals(await getVault(context, vault, event.chainId, timestamp), delta);
  v = { ...v, ...price, totalSupply: v.totalSupply + supplyChange(e), lockedIncome: lockedIncome ?? v.lockedIncome };
  if (bond) {
    bond = low(bond);
    const h = updateHolding(await context.VaultHolding.get(`${vault}-${bond}`) ?? emptyHolding(vault, bond), kind, assets);
    context.VaultHolding.set(h);
    v = { ...v, holdings: h.active ? [...new Set([...v.holdings, bond])] : v.holdings.filter(b => b !== bond) };
  }
  if (kind === 'CuratorProposed') v = { ...v, pendingCurator: low(actor), curatorChangeAfter: (event as EvmEvent<'BondrailVault', 'CuratorProposed'>).params.executableAt };
  if (kind === 'CuratorChanged') v = { ...v, curator: low(actor), pendingCurator: undefined, curatorChangeAfter: undefined };
  context.Vault.set(v);
  const daily = await context.VaultDailySnapshot.get(`${vault}-${day}`) ?? {
    id: `${vault}-${day}`, vault, day, timestamp, block: BigInt(event.block.number), eventCount: 0,
    ...emptyTotals(), ...emptyPrice(), totalSupply: 0n, lockedIncome: 0n,
  };
  context.VaultDailySnapshot.set({ ...addTotals(daily, delta), ...price, timestamp, block: BigInt(event.block.number),
    totalSupply: v.totalSupply, lockedIncome: v.lockedIncome, eventCount: daily.eventCount + 1 });
  context.VaultActivity.set({ id: `${event.chainId}:${event.block.number}:${event.transaction.hash}:${event.logIndex}`,
    chainId: event.chainId, vault, kind, actor: low(actor), receiver: low(receiver), bond, assets, shares,
    timestamp, block: BigInt(event.block.number), txHash: event.transaction.hash, realizedPrice: price?.realizedPrice, lockedIncome });
}

indexer.onEvent({ contract: 'BondrailVault', event: 'Deposit' }, async ({ event, context }) => {
  const vault = low(event.srcAddress), holder = low(event.params.owner);
  const p = await context.VaultPosition.get(`${vault}-${holder}`) ?? position(vault, holder);
  context.VaultPosition.set({ ...p, costBasis: p.costBasis + event.params.assets, deposited: p.deposited + event.params.assets });
  await activity(context, event, 'Deposit', event.params.sender, holder, '', event.params.assets, event.params.shares);
});
indexer.onEvent({ contract: 'BondrailVault', event: 'Withdraw' }, async ({ event, context }) => {
  const vault = low(event.srcAddress), holder = low(event.params.owner);
  const p = await context.VaultPosition.get(`${vault}-${holder}`) ?? position(vault, holder);
  context.VaultPosition.set({ ...p, withdrawn: p.withdrawn + event.params.assets });
  await activity(context, event, 'Withdraw', holder, event.params.receiver, '', event.params.assets, event.params.shares);
});
indexer.onEvent({ contract: 'BondrailVault', event: 'Allocated' }, async ({ event, context }) => {
  await activity(context, event, 'Allocated', '', '', event.params.bond, event.params.assets);
});
indexer.onEvent({ contract: 'BondrailVault', event: 'Collected' }, async ({ event, context }) => {
  await activity(context, event, 'Collected', '', '', event.params.bond, event.params.assets, event.params.claims);
});
indexer.onEvent({ contract: 'BondrailVault', event: 'RaiseWithdrawn' }, async ({ event, context }) => {
  await activity(context, event, 'RaiseWithdrawn', '', '', event.params.bond, event.params.assets);
});
indexer.onEvent({ contract: 'BondrailVault', event: 'IncomeCheckpointed' }, async ({ event, context }) => {
  await activity(context, event, 'IncomeCheckpointed', '', '', '', event.params.newIncome, 0n, event.params.lockedIncome);
});
indexer.onEvent({ contract: 'BondrailVault', event: 'CuratorProposed' }, async ({ event, context }) => {
  await activity(context, event, 'CuratorProposed', event.params.curator);
});
indexer.onEvent({ contract: 'BondrailVault', event: 'CuratorChanged' }, async ({ event, context }) => {
  await activity(context, event, 'CuratorChanged', event.params.curator, event.params.previousCurator);
});
