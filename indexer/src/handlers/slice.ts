// Slice event handlers: revenue streams, payments and payer attribution, bond lifecycle, covenant checks.
import { indexer } from 'envio';

const low = (a: string) => a.toLowerCase();
const rowId = (e: any) => `${e.chainId}:${e.block.number}:${e.transaction?.hash ?? e.block.hash}:${e.logIndex}`;
const DAY = 86_400;
// The factory address comes from the deployment the config was generated from.
import { FACTORY } from '../deployment';

// ---------- dynamic contracts: everything the factory creates gets indexed ----------

indexer.contractRegister({ contract: 'SliceFactory', event: 'RouterCreated' }, async ({ event, context }) => {
  context.chain.SliceRouter.add(event.params.router);
});
indexer.contractRegister({ contract: 'SliceFactory', event: 'BondCreated' }, async ({ event, context }) => {
  context.chain.SliceBond.add(event.params.bond);
});
indexer.contractRegister(
  { contract: 'SliceFactory', event: 'LockedSourceCreated' },
  async ({ event, context }) => {
    context.chain.PumpLab.add(event.params.source);
  },
);

// ---------- issuers ----------

indexer.onEvent({ contract: 'SliceFactory', event: 'RouterCreated' }, async ({ event, context }) => {
  const router = low(event.params.router);
  const issuer = low(event.params.issuer);
  context.Issuer.set({
    id: router,
    chainId: event.chainId,
    issuer,
    payout: issuer, // the factory sets payout = issuer at creation
    adapter: undefined,
    source: undefined,
    guard: undefined,
    activeBond: undefined,
    grossRevenue: 0n,
    toInvestors: 0n,
    toIssuer: 0n,
    payments: 0,
    createdAt: BigInt(event.block.timestamp),
  });
  context.Treasury.set({ id: issuer, router });
});

indexer.onEvent({ contract: 'SliceFactory', event: 'LockedSourceCreated' }, async ({ event, context }) => {
  const i = await context.Issuer.get(low(event.params.router));
  if (!i) return;
  context.Issuer.set({ ...i, source: low(event.params.source), guard: low(event.params.guard) });
});

indexer.onEvent({ contract: 'SliceFactory', event: 'BondCreated' }, async ({ event, context }) => {
  const router = low(event.params.router);
  const bond = low(event.params.bond);
  const i = await context.Issuer.get(router);
  if (i) context.Issuer.set({ ...i, adapter: Number(event.params.adapter), activeBond: bond });
  context.Bond.set({
    id: bond,
    chainId: event.chainId,
    router,
    issuer: low(event.params.issuer),
    adapter: Number(event.params.adapter),
    policyHash: event.params.policyHash,
    phase: 0,
    raised: 0n,
    released: 0n,
    undrawn: 0n,
    principalRecovery: 0n,
    revenueCollected: 0n,
    stakeRecovery: 0n,
    pool: 0n,
    redeemed: 0n,
    totalSupply: 0n,
    effectiveCap: 0n,
    defaulted: false,
    createdAt: BigInt(event.block.timestamp),
  });
  log(context, event, bond, 'Created', event.params.issuer, 0n);
});

indexer.onEvent({ contract: 'SliceFactory', event: 'MilestoneAccepted' }, async ({ event, context }) => {
  log(context, event, low(event.params.bond), 'MilestoneAccepted', '', event.params.eligibleRevenue);
});

// ---------- router: sweeps split revenue between investors and the issuer ----------

indexer.onEvent({ contract: 'SliceRouter', event: 'Swept' }, async ({ event, context }) => {
  const router = low(event.srcAddress);
  context.Sweep.set({
    id: rowId(event),
    router,
    bond: low(event.params.bond),
    gross: event.params.gross,
    toBond: event.params.investorAmount,
    toIssuer: event.params.issuerAmount,
    timestamp: BigInt(event.block.timestamp),
    txHash: event.transaction.hash,
  });
  const i = await context.Issuer.get(router);
  if (i)
    context.Issuer.set({
      ...i,
      toInvestors: i.toInvestors + event.params.investorAmount,
      toIssuer: i.toIssuer + event.params.issuerAmount,
    });
});

indexer.onEvent({ contract: 'SliceRouter', event: 'Attached' }, async ({ event, context }) => {
  const i = await context.Issuer.get(low(event.srcAddress));
  if (i) context.Issuer.set({ ...i, activeBond: low(event.params.bond) });
});
indexer.onEvent({ contract: 'SliceRouter', event: 'Detached' }, async ({ event, context }) => {
  const i = await context.Issuer.get(low(event.srcAddress));
  if (i) context.Issuer.set({ ...i, activeBond: undefined });
});

// ---------- payments ----------

async function recordPayment(
  context: any,
  event: any,
  router: string,
  payer: string,
  amount: bigint,
  source: 'x402' | 'launchpad',
  receiptId: string,
) {
  const issuer = await context.Issuer.get(router);
  if (!issuer) return;
  const wallet = await context.Wallet.get(payer);
  const reasons: string[] = [];
  if (payer === issuer.issuer || payer === issuer.payout) reasons.push('issuer_wallet');
  if (wallet?.fundedByRouter === router) reasons.push('funded_by_issuer_treasury');
  const related = reasons.length > 0;
  const ts = BigInt(event.block.timestamp);
  context.Payment.set({
    id: rowId(event),
    chainId: event.chainId,
    router,
    receiptId,
    payer,
    amount,
    timestamp: ts,
    source,
    synthetic: false,
    related,
    evidenceComplete: true,
    reasons,
    txHash: event.transaction.hash,
  });
  context.Issuer.set({ ...issuer, grossRevenue: issuer.grossRevenue + amount, payments: issuer.payments + 1 });
  const day = Math.floor(Number(ts) / DAY);
  const dayId = `${router}-${day}`;
  const d = (await context.DailyRevenue.get(dayId)) ?? { id: dayId, router, day, gross: 0n, verified: 0n, payments: 0 };
  context.DailyRevenue.set({
    ...d,
    gross: d.gross + amount,
    verified: d.verified + (related ? 0n : amount),
    payments: d.payments + 1,
  });
}

indexer.onEvent({ contract: 'USDC', event: 'Transfer' }, async ({ event, context }) => {
  const from = low(event.params.from);
  const to = low(event.params.to);
  const value = event.params.value;
  if (value === 0n) return;

  // Treasury funding: issuer or payout wallet sending USDC to someone else (wash-trading detector input).
  // Transfers inside Slice calls (stake posted through the factory, deposits) are not funding edges.
  const viaSlice = low(event.transaction.to ?? '') === FACTORY || !!(await context.Bond.get(to));
  const treasury = await context.Treasury.get(from);
  if (treasury && !viaSlice && !(await context.Issuer.get(to))) {
    context.FundingEdge.set({
      id: rowId(event),
      chainId: event.chainId,
      issuerRouter: treasury.router,
      sender: from,
      recipient: to,
      amount: value,
      timestamp: BigInt(event.block.timestamp),
      txHash: event.transaction.hash,
    });
    const w = (await context.Wallet.get(to)) ?? { id: to, fundedByRouter: undefined, fundedAmount: 0n };
    context.Wallet.set({ ...w, fundedByRouter: treasury.router, fundedAmount: w.fundedAmount + value });
  }

  // Receipts into a router. Launchpad fee transfers come from the PumpLab contract and are attributed
  // to the trader by the Trade handler instead; everything else is a direct (x402) payment by `from`.
  const issuer = await context.Issuer.get(to);
  if (!issuer) return;
  const id = rowId(event);
  context.Receipt.set({
    id,
    chainId: event.chainId,
    router: to,
    sender: from,
    amount: value,
    block: BigInt(event.block.number),
    blockHash: event.block.hash,
    txHash: event.transaction.hash,
    logIndex: event.logIndex,
    timestamp: BigInt(event.block.timestamp),
  });
  if (issuer.source && from === issuer.source) return;
  await recordPayment(context, event, to, from, value, 'x402', id);
});

indexer.onEvent({ contract: 'PumpLab', event: 'Trade' }, async ({ event, context }) => {
  const router = low(event.params.router);
  const trader = low(event.params.payer);
  context.SourceTrade.set({
    id: rowId(event),
    chainId: event.chainId,
    source: low(event.srcAddress),
    router,
    trader,
    fee: event.params.fee,
    usdcAmount: event.params.grossUSDC,
    isBuy: event.params.isBuy,
    txHash: event.transaction.hash,
    timestamp: BigInt(event.block.timestamp),
  });
  if (event.params.fee > 0n) await recordPayment(context, event, router, trader, event.params.fee, 'launchpad', rowId(event));
});

// ---------- bonds ----------

function log(context: any, event: any, address: string, kind: string, account: string, amount: bigint) {
  context.ChainEvent.set({
    id: rowId(event),
    chainId: event.chainId,
    address,
    kind,
    account: low(account || ''),
    amount,
    block: BigInt(event.block.number),
    blockHash: event.block.hash,
    txHash: event.transaction?.hash ?? '',
    timestamp: BigInt(event.block.timestamp),
  });
}

async function bondOf(context: any, event: any) {
  return context.Bond.get(low(event.srcAddress));
}

indexer.onEvent({ contract: 'SliceBond', event: 'Deposited' }, async ({ event, context }) => {
  const b = await bondOf(context, event);
  if (b) context.Bond.set({ ...b, raised: event.params.funded });
  log(context, event, low(event.srcAddress), 'Deposited', event.params.payer, event.params.amount);
});

indexer.onEvent({ contract: 'SliceBond', event: 'Activated' }, async ({ event, context }) => {
  const b = await bondOf(context, event);
  if (b)
    context.Bond.set({
      ...b,
      phase: 1,
      released: event.params.released,
      undrawn: event.params.undrawn,
      effectiveCap: event.params.effectiveCap,
    });
  log(context, event, low(event.srcAddress), 'Activated', event.params.issuer, event.params.released);
});

indexer.onEvent({ contract: 'SliceBond', event: 'PrincipalReleased' }, async ({ event, context }) => {
  const b = await bondOf(context, event);
  if (b)
    context.Bond.set({
      ...b,
      released: event.params.releasedTotal,
      undrawn: 0n,
      effectiveCap: event.params.effectiveCap,
    });
  log(context, event, low(event.srcAddress), 'PrincipalReleased', '', event.params.amount);
});

indexer.onEvent({ contract: 'SliceBond', event: 'UndrawnRecovered' }, async ({ event, context }) => {
  const b = await bondOf(context, event);
  if (b)
    context.Bond.set({
      ...b,
      undrawn: 0n,
      principalRecovery: event.params.recoveryTotal,
      pool: b.pool + event.params.amount,
    });
  log(context, event, low(event.srcAddress), 'UndrawnRecovered', '', event.params.amount);
});

indexer.onEvent({ contract: 'SliceBond', event: 'RevenueReceived' }, async ({ event, context }) => {
  const b = await bondOf(context, event);
  if (b) context.Bond.set({ ...b, revenueCollected: event.params.totalRevenue, pool: event.params.pool });
  log(context, event, low(event.srcAddress), 'RevenueReceived', '', event.params.amount);
});

indexer.onEvent({ contract: 'SliceBond', event: 'DefaultRecorded' }, async ({ event, context }) => {
  const b = await bondOf(context, event);
  if (b)
    context.Bond.set({
      ...b,
      defaulted: true,
      stakeRecovery: b.stakeRecovery + event.params.stakeRecovered,
      pool: b.pool + event.params.stakeRecovered,
    });
  log(context, event, low(event.srcAddress), 'Defaulted', '', event.params.stakeRecovered);
});

indexer.onEvent({ contract: 'SliceBond', event: 'CollectionClosed' }, async ({ event, context }) => {
  const b = await bondOf(context, event);
  // Watched bonds enter Closing (2) for the evidence window; Locked bonds close straight away (3).
  if (b) context.Bond.set({ ...b, phase: event.params.settleAfter > 0n ? 2 : 3, pool: event.params.pool });
  log(context, event, low(event.srcAddress), 'CollectionClosed', '', event.params.pool);
});

indexer.onEvent({ contract: 'SliceBond', event: 'SettlementFinalized' }, async ({ event, context }) => {
  const b = await bondOf(context, event);
  if (b) context.Bond.set({ ...b, phase: 3, pool: event.params.pool });
  log(context, event, low(event.srcAddress), 'Settled', '', event.params.pool);
});

indexer.onEvent({ contract: 'SliceBond', event: 'FundingCancelled' }, async ({ event, context }) => {
  const b = await bondOf(context, event);
  if (b) context.Bond.set({ ...b, phase: 4 });
  log(context, event, low(event.srcAddress), 'Cancelled', '', event.params.refundable);
});

indexer.onEvent({ contract: 'SliceBond', event: 'Refunded' }, async ({ event, context }) => {
  log(context, event, low(event.srcAddress), 'Refunded', event.params.holder, event.params.amount);
});

indexer.onEvent({ contract: 'SliceBond', event: 'Redeemed' }, async ({ event, context }) => {
  const b = await bondOf(context, event);
  if (b) context.Bond.set({ ...b, pool: b.pool - event.params.amount, redeemed: b.redeemed + event.params.amount });
  log(context, event, low(event.srcAddress), 'Redeemed', event.params.holder, event.params.amount);
});

indexer.onEvent({ contract: 'SliceBond', event: 'Transfer' }, async ({ event, context }) => {
  const bond = low(event.srcAddress);
  const from = low(event.params.from);
  const to = low(event.params.to);
  const v = event.params.value;
  const zero = '0x0000000000000000000000000000000000000000';
  const move = async (holder: string, delta: bigint) => {
    const id = `${bond}-${holder}`;
    const h = (await context.Holder.get(id)) ?? { id, bond, holder, balance: 0n };
    context.Holder.set({ ...h, balance: h.balance + delta });
  };
  if (from !== zero) await move(from, -v);
  if (to !== zero) await move(to, v);
  const b = await context.Bond.get(bond);
  if (b && (from === zero || to === zero))
    context.Bond.set({ ...b, totalSupply: b.totalSupply + (from === zero ? v : -v) });
});

// ---------- covenant (Watched adapter) ----------

indexer.onEvent({ contract: 'SliceCovenant', event: 'ObservationAccepted' }, async ({ event, context }) => {
  context.CovenantCheck.set({
    id: rowId(event),
    chainId: event.chainId,
    bond: low(event.params.bond),
    result: Number(event.params.result),
    epoch: event.params.epoch,
    observedAt: event.params.observedAt,
    evidenceHash: event.params.evidenceHash,
    txHash: event.transaction.hash,
    timestamp: BigInt(event.block.timestamp),
  });
});

indexer.onEvent({ contract: 'SliceCovenant', event: 'CovenantDefault' }, async ({ event, context }) => {
  log(context, event, low(event.params.bond), 'CovenantDefault', '', 0n);
});
