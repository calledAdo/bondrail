// Slice event handlers: accounts and their revenue history, payer attribution, bond lifecycle, covenant.
import { indexer } from 'envio';
import { FACTORY } from '../deployment';

const low = (a: string) => a.toLowerCase();
const rowId = (e: any) => `${e.chainId}:${e.block.number}:${e.transaction?.hash ?? e.block.hash}:${e.logIndex}`;
const DAY = 86_400;
const NATIVE = 0;
const LOCKED = 1;
const WATCHED = 2;

// ---------- dynamic contracts: everything the factory creates gets indexed ----------

indexer.contractRegister({ contract: 'SliceFactory', event: 'AccountCreated' }, async ({ event, context }) => {
  context.chain.SliceAccount.add(event.params.account);
});
indexer.contractRegister({ contract: 'SliceFactory', event: 'BondCreated' }, async ({ event, context }) => {
  context.chain.SliceBond.add(event.params.bond);
});
indexer.contractRegister({ contract: 'SliceFactory', event: 'NativeSourceCreated' }, async ({ event, context }) => {
  context.chain.PumpLab.add(event.params.source);
});
indexer.contractRegister({ contract: 'SliceFactory', event: 'LockedSourceCreated' }, async ({ event, context }) => {
  context.chain.PumpLabClassic.add(event.params.source);
});

// ---------- accounts ----------

indexer.onEvent({ contract: 'SliceFactory', event: 'AccountCreated' }, async ({ event, context }) => {
  const account = low(event.params.account);
  const issuer = low(event.params.issuer);
  context.Issuer.set({
    id: account,
    chainId: event.chainId,
    issuer,
    tier: undefined,
    project: undefined,
    source: undefined,
    guard: undefined,
    activeBond: undefined,
    grossRevenue: 0n,
    toInvestors: 0n,
    toIssuer: 0n,
    payments: 0,
    createdAt: BigInt(event.block.timestamp),
    firstRevenueAt: undefined,
  });
  context.Treasury.set({ id: issuer, account });
});

indexer.onEvent({ contract: 'SliceFactory', event: 'NativeSourceCreated' }, async ({ event, context }) => {
  const i = await context.Issuer.get(low(event.params.account));
  if (i) context.Issuer.set({ ...i, tier: NATIVE, project: low(event.params.source) });
});

indexer.onEvent({ contract: 'SliceFactory', event: 'LockedSourceCreated' }, async ({ event, context }) => {
  const i = await context.Issuer.get(low(event.params.account));
  if (i) context.Issuer.set({ ...i, tier: LOCKED, source: low(event.params.source), guard: low(event.params.guard) });
});

indexer.onEvent({ contract: 'SliceFactory', event: 'BondCreated' }, async ({ event, context }) => {
  const account = low(event.params.account);
  const bond = low(event.params.bond);
  const adapter = Number(event.params.adapter);
  const i = await context.Issuer.get(account);
  if (i) context.Issuer.set({ ...i, tier: adapter, activeBond: bond });
  context.Bond.set({
    id: bond,
    chainId: event.chainId,
    account,
    issuer: low(event.params.issuer),
    adapter,
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

indexer.onEvent({ contract: 'SliceFactory', event: 'SecondReleaseApproved' }, async ({ event, context }) => {
  log(
    context,
    event,
    low(event.params.bond),
    Number(event.params.mode) === 0 ? 'MilestoneOnchain' : 'MilestoneSigned',
    '',
    event.params.eligibleRevenue,
  );
});

// Every booked payment: how it was split, and (for Native collects) the proven payer.
indexer.onEvent({ contract: 'SliceAccount', event: 'Revenue' }, async ({ event, context }) => {
  const account = low(event.srcAddress);
  const payer = low(event.params.payer);
  context.Split.set({
    id: rowId(event),
    account,
    bond: low(event.params.bond),
    payer,
    collected: event.params.collected,
    gross: event.params.amount,
    toBond: event.params.toBond,
    toIssuer: event.params.toIssuer,
    timestamp: BigInt(event.block.timestamp),
    txHash: event.transaction.hash,
  });
  const i = await context.Issuer.get(account);
  if (i)
    context.Issuer.set({
      ...i,
      toInvestors: i.toInvestors + event.params.toBond,
      toIssuer: i.toIssuer + event.params.toIssuer,
      firstRevenueAt: i.firstRevenueAt ?? BigInt(event.block.timestamp),
    });
  if (event.params.collected)
    await recordPayment(context, event, account, payer, event.params.amount, 'native', rowId(event));
});

indexer.onEvent({ contract: 'SliceAccount', event: 'Attached' }, async ({ event, context }) => {
  const i = await context.Issuer.get(low(event.srcAddress));
  if (i) context.Issuer.set({ ...i, activeBond: low(event.params.bond) });
});
indexer.onEvent({ contract: 'SliceAccount', event: 'Detached' }, async ({ event, context }) => {
  const i = await context.Issuer.get(low(event.srcAddress));
  if (i) context.Issuer.set({ ...i, activeBond: undefined });
});

// ---------- payments ----------

async function recordPayment(
  context: any,
  event: any,
  account: string,
  payer: string,
  amount: bigint,
  source: 'native' | 'launchpad' | 'x402',
  receiptId: string,
) {
  const issuer = await context.Issuer.get(account);
  if (!issuer) return;
  const wallet = await context.Wallet.get(payer);
  const reasons: string[] = [];
  if (payer === issuer.issuer) reasons.push('issuer_wallet');
  if (wallet?.fundedByAccount === account) reasons.push('funded_by_issuer_treasury');
  const related = reasons.length > 0;
  const ts = BigInt(event.block.timestamp);
  context.Payment.set({
    id: `${rowId(event)}:${source}`,
    chainId: event.chainId,
    account,
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
  const dayId = `${account}-${day}`;
  const d = (await context.DailyRevenue.get(dayId)) ?? {
    id: dayId,
    account,
    day,
    gross: 0n,
    verified: 0n,
    payments: 0,
  };
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

  // Treasury funding: the issuer's wallet sending USDC to someone else (wash-trading detector input).
  // Transfers made inside Slice calls (stake through the factory, deposits into bonds) don't count.
  const viaSlice = low(event.transaction.to ?? '') === FACTORY || !!(await context.Bond.get(to));
  const treasury = await context.Treasury.get(from);
  if (treasury && !viaSlice && !(await context.Issuer.get(to))) {
    context.FundingEdge.set({
      id: rowId(event),
      chainId: event.chainId,
      issuerAccount: treasury.account,
      sender: from,
      recipient: to,
      amount: value,
      timestamp: BigInt(event.block.timestamp),
      txHash: event.transaction.hash,
    });
    const w = (await context.Wallet.get(to)) ?? { id: to, fundedByAccount: undefined, fundedAmount: 0n };
    context.Wallet.set({ ...w, fundedByAccount: treasury.account, fundedAmount: w.fundedAmount + value });
  }

  // Plain receipts into a Watched account are x402 settlements: the facilitator moves funds from the payer.
  // Native accounts receive pulls (attributed by Revenue); Locked accounts receive launchpad fees
  // (attributed by the launchpad's Trade event).
  const issuer = await context.Issuer.get(to);
  if (!issuer) return;
  const id = rowId(event);
  context.Receipt.set({
    id,
    chainId: event.chainId,
    account: to,
    sender: from,
    amount: value,
    block: BigInt(event.block.number),
    blockHash: event.block.hash,
    txHash: event.transaction.hash,
    logIndex: event.logIndex,
    timestamp: BigInt(event.block.timestamp),
  });
  if (issuer.tier === WATCHED) await recordPayment(context, event, to, from, value, 'x402', id);
});

indexer.onEvent({ contract: 'PumpLab', event: 'Trade' }, async ({ event, context }) => {
  context.SourceTrade.set({
    id: rowId(event),
    chainId: event.chainId,
    source: low(event.srcAddress),
    account: '',
    trader: low(event.params.trader),
    fee: event.params.fee,
    usdcAmount: event.params.grossUSDC,
    isBuy: event.params.isBuy,
    txHash: event.transaction.hash,
    timestamp: BigInt(event.block.timestamp),
  });
});

indexer.onEvent({ contract: 'PumpLabClassic', event: 'Trade' }, async ({ event, context }) => {
  const account = low(event.params.recipient);
  const trader = low(event.params.payer);
  context.SourceTrade.set({
    id: rowId(event),
    chainId: event.chainId,
    source: low(event.srcAddress),
    account,
    trader,
    fee: event.params.fee,
    usdcAmount: event.params.grossUSDC,
    isBuy: event.params.isBuy,
    txHash: event.transaction.hash,
    timestamp: BigInt(event.block.timestamp),
  });
  if (event.params.fee > 0n)
    await recordPayment(context, event, account, trader, event.params.fee, 'launchpad', rowId(event));
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
  // Watched bonds enter Closing (2) for the evidence window; Native and Locked close straight away (3).
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

// ---------- covenant (Watched) ----------

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
