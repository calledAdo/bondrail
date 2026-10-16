import { indexer, type EvmOnEventContext, type EvmEvent } from 'envio';
import { vaultState, blockTime } from '../vault-state';
const low = (a: string) => a.toLowerCase();
const ZERO = '0x0000000000000000000000000000000000000000';
const zeroHash = `0x${'0'.repeat(64)}`;
type Context = EvmOnEventContext;
type Event = EvmEvent<'BondrailVault'>;

indexer.contractRegister({ contract: 'BondrailVaultFactory', event: 'VaultCreated' }, async ({ event, context }) => {
  context.chain.BondrailVault.add(event.params.vault);
});

export async function snapshotVault(context: Context, vault: string, chainId: number, block: number, timestamp: bigint) {
  const state = await context.effect(vaultState, { chainId, vault, block });
  const old = await context.Vault.get(vault);
  if (!old) context.Vault.set({ id: vault, chainId, registry: '', asset: low(state.asset), owner: low(state.owner),
    curator: low(state.curator), name: state.name, symbol: state.symbol,
    strategy: 'Diversified revenue bonds under fixed allocation limits', metadataHash: zeroHash,
    pendingCurator: undefined, curatorChangeAfter: undefined, createdAt: timestamp });
  const day = Number(timestamp / 86400n);
  context.VaultDailySnapshot.set({ id: `${vault}-${day}`, vault, day, timestamp, block: BigInt(block),
    nav: state.nav, entryNav: state.entryNav, idle: state.idle, totalSupply: state.totalSupply,
    entryPrice: state.entryPrice, exitPrice: state.exitPrice });
}

indexer.onEvent({ contract: 'BondrailVaultFactory', event: 'VaultCreated' }, async ({ event, context }) => {
  const p = event.params, vault = low(p.vault);
  const old = await context.Vault.get(vault);
  context.Vault.set({ id: vault, chainId: event.chainId, registry: low(event.srcAddress), asset: low(p.asset),
    owner: low(p.owner), curator: low(p.curator), name: p.name, symbol: p.symbol,
    strategy: p.strategy.description, metadataHash: p.strategy.metadataHash,
    pendingCurator: old?.pendingCurator, curatorChangeAfter: old?.curatorChangeAfter,
    createdAt: old?.createdAt ?? BigInt(event.block.timestamp) });
  await snapshotVault(context, vault, event.chainId, event.block.number, BigInt(event.block.timestamp));
});

function position(vault: string, holder: string) {
  return { id: `${vault}-${holder}`, vault, holder, shares: 0n, costBasis: 0n, deposited: 0n, withdrawn: 0n };
}

indexer.onEvent({ contract: 'BondrailVault', event: 'Transfer' }, async ({ event, context }) => {
  const vault = low(event.srcAddress), from = low(event.params.from), to = low(event.params.to), shares = event.params.value;
  if (from === to) return;
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
});

async function activity(context: Context, event: Event, kind: string, actor = '', receiver = '', bond = '', assets = 0n, shares = 0n) {
  const vault = low(event.srcAddress);
  context.VaultActivity.set({ id: `${event.chainId}:${event.block.number}:${event.transaction.hash}:${event.logIndex}`,
    chainId: event.chainId, vault, kind, actor: low(actor), receiver: low(receiver), bond: low(bond), assets, shares,
    timestamp: BigInt(event.block.timestamp), block: BigInt(event.block.number), txHash: event.transaction.hash });
  await snapshotVault(context, vault, event.chainId, event.block.number, BigInt(event.block.timestamp));
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
  await activity(context, event, 'IncomeCheckpointed', '', '', '', event.params.newIncome);
});
indexer.onEvent({ contract: 'BondrailVault', event: 'CuratorProposed' }, async ({ event, context }) => {
  await activity(context, event, 'CuratorProposed', event.params.curator);
  const v = await context.Vault.get(low(event.srcAddress));
  if (v) context.Vault.set({ ...v, pendingCurator: low(event.params.curator), curatorChangeAfter: event.params.executableAt });
});
indexer.onEvent({ contract: 'BondrailVault', event: 'CuratorChanged' }, async ({ event, context }) => {
  await activity(context, event, 'CuratorChanged', event.params.curator, event.params.previousCurator);
  const v = await context.Vault.get(low(event.srcAddress));
  if (v) context.Vault.set({ ...v, curator: low(event.params.curator), pendingCurator: undefined, curatorChangeAfter: undefined });
});

// The first sampled block on each UTC day captures time-only write-down/vesting changes, even without
// vault transactions. Activity refreshes that day's row. Historical RPC failure stops/retries indexing.
indexer.onBlock({ name: 'vaultDailySnapshots', where: () => ({ block: { number: { _every: 300 } } }) }, async ({ block, context }) => {
  const chainId = context.chain.id;
  const vaults = await context.Vault.getWhere({ chainId: { _eq: chainId } });
  if (!vaults.length) return;
  const timestamp = await context.effect(blockTime, { chainId, block: block.number });
  for (const v of vaults) {
    if (await context.VaultDailySnapshot.get(`${v.id}-${timestamp / 86400n}`)) continue;
    await snapshotVault(context, v.id, chainId, block.number, timestamp);
  }
});
