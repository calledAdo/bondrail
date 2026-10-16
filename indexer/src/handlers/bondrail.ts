// Bondrail event handlers: accounts and their revenue history, payer attribution, bond lifecycle, covenant.
import { indexer } from 'envio';
import { FACTORY, INDEXED_ASSET } from '../deployment';

const low = (a: string) => a.toLowerCase();
const rowId = (e: any) => `${e.chainId}:${e.block.number}:${e.transaction?.hash ?? e.block.hash}:${e.logIndex}`;
const DAY = 86_400;
const NATIVE = 0;
const authorizationId = (e: any, payer: string) => `${e.chainId}:${low(e.srcAddress)}:${e.transaction.hash}:${payer}`;
const settlementId = (e: any) => `${e.chainId}:${e.transaction.hash}:${low(e.srcAddress)}`;
const x402Id = (e: any, asset: string, payer: string, nonce: string) => `${e.chainId}:${asset}:${payer}:${low(nonce)}:x402`;

// ---------- dynamic contracts: everything the factory creates gets indexed ----------

indexer.contractRegister({ contract: 'BondrailFactory', event: 'AccountCreated' }, async ({ event, context }) => {
  context.chain.BondrailAccount.add(event.params.account);
});
indexer.contractRegister({ contract: 'BondrailFactory', event: 'BondCreated' }, async ({ event, context }) => {
  context.chain.BondrailBond.add(event.params.bond);
});
// ---------- accounts ----------

indexer.onEvent({ contract: 'BondrailFactory', event: 'AccountCreated' }, async ({ event, context }) => {
  const account = low(event.params.account);
  const issuer = low(event.params.issuer);
  context.Issuer.set({
    id: account,
    chainId: event.chainId,
    issuer,
    asset: low(event.params.asset),
    tier: undefined,
    project: undefined,
    projectApproved: undefined,
      template: undefined,
    activeBond: undefined,
    grossRevenue: 0n,
    volume: 0n,
    toInvestors: 0n,
    toIssuer: 0n,
    payments: 0,
    createdAt: BigInt(event.block.timestamp),
    firstRevenueAt: undefined,
  });
  const treasury = await context.Treasury.get(issuer);
  context.Treasury.set({ id: issuer, accounts: [...(treasury?.accounts ?? []), account] });
});

// Native: the account binds a project that inherits BondrailEarner (pointed at this account forever).
indexer.onEvent({ contract: 'BondrailAccount', event: 'ProjectBound' }, async ({ event, context }) => {
  const i = await context.Issuer.get(low(event.srcAddress));
  if (i) context.Issuer.set({ ...i, tier: NATIVE, project: low(event.params.project) });
});

// The disclosed reviewer approves (or revokes) a Native project.
indexer.onEvent({ contract: 'BondrailFactory', event: 'NativeApproval' }, async ({ event, context }) => {
  const project = low(event.params.project);
  for (const i of await context.Issuer.getWhere({ project: { _eq: project } }))
    context.Issuer.set({ ...i, projectApproved: event.params.approved });
});

// A project deployed from a reviewed template is approved with it; revoking the template revokes it.
indexer.onEvent({ contract: 'BondrailFactory', event: 'NativeDeployed' }, async ({ event, context }) => {
  const i = await context.Issuer.get(low(event.params.account));
  if (i)
    context.Issuer.set({
      ...i,
      tier: NATIVE,
      project: low(event.params.project),
      projectApproved: true,
      template: event.params.initCodeHash,
    });
});

indexer.onEvent({ contract: 'BondrailFactory', event: 'NativeTemplate' }, async ({ event, context }) => {
  for (const i of await context.Issuer.getWhere({ template: { _eq: event.params.initCodeHash } }))
    context.Issuer.set({ ...i, projectApproved: event.params.approved });
});

indexer.onEvent({ contract: 'BondrailFactory', event: 'BondCreated' }, async ({ event, context }) => {
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
    triggered: false,
    createdAt: BigInt(event.block.timestamp),
  });
  log(context, event, bond, 'Created', event.params.issuer, 0n);
});

indexer.onEvent({ contract: 'BondrailFactory', event: 'SecondReleaseApproved' }, async ({ event, context }) => {
  log(
    context,
    event,
    low(event.params.bond),
    Number(event.params.mode) === 0 ? 'MilestoneOnchain' : 'MilestoneSigned',
    '',
    event.params.eligibleRevenue,
  );
});

// A settlement is a proven x402 payment. The indexed token's Transfer may already have recorded it;
// the nonce is the shared identity, independent of transaction entrypoint or batching.
indexer.onEvent({ contract: 'BondrailAccount', event: 'Settled' }, async ({ event, context }) => {
  const account = low(event.srcAddress);
  const payer = low(event.params.payer);
  const issuer = await context.Issuer.get(account);
  if (!issuer) return;
  context.Issuer.set({ ...issuer, volume: issuer.volume + event.params.value });
  context.AccountSettlement.set({ id: settlementId(event), payer, amount: event.params.value });
  await recordPayment(context, event, account, payer, event.params.value, 'x402', rowId(event), [],
    x402Id(event, issuer.asset, payer, event.params.nonce));
});

// Every booked payment: split accounting; Settled already attributes an authorized payment.
indexer.onEvent({ contract: 'BondrailAccount', event: 'Revenue' }, async ({ event, context }) => {
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
  const settled = await context.AccountSettlement.get(settlementId(event));
  if (event.params.collected && settled?.payer === payer && settled.amount === event.params.amount) {
    context.AccountSettlement.deleteUnsafe(settled.id);
  } else if (event.params.collected)
    await recordPayment(context, event, account, payer, event.params.amount, 'native', rowId(event));
  // Swept receipts in an asset whose Transfers are not indexed remain unclassified.
  else if (i && i.asset !== INDEXED_ASSET)
    await recordPayment(context, event, account, payer, event.params.amount, 'transfer', rowId(event), [
      'unclassified_inflow',
    ]);
});

// Native payment, in (payer paid the project) or out (the project paid the payer): adds to volume.
indexer.onEvent({ contract: 'BondrailAccount', event: 'Collected' }, async ({ event, context }) => {
  const i = await context.Issuer.get(low(event.srcAddress));
  if (i) context.Issuer.set({ ...i, volume: i.volume + event.params.gross });
});

indexer.onEvent({ contract: 'BondrailAccount', event: 'Attached' }, async ({ event, context }) => {
  const i = await context.Issuer.get(low(event.srcAddress));
  if (i) context.Issuer.set({ ...i, activeBond: low(event.params.bond) });
});
indexer.onEvent({ contract: 'BondrailAccount', event: 'Detached' }, async ({ event, context }) => {
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
  source: 'native' | 'transfer' | 'x402',
  receiptId: string,
  extraReasons: string[] = [],
  paymentId = `${rowId(event)}:${source}`,
) {
  if (await context.Payment.get(paymentId)) return;
  const issuer = await context.Issuer.get(account);
  if (!issuer) return;
  const reasons: string[] = [...extraReasons];
  if (payer === issuer.issuer) reasons.push('issuer_wallet');
  if (await context.FundingLink.get(`${account}-${payer}`)) reasons.push('funded_by_issuer_treasury');
  const related = reasons.length > 0;
  const ts = BigInt(event.block.timestamp);
  context.Payment.set({
    id: paymentId,
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
    x402: 0n,
    payments: 0,
  };
  context.DailyRevenue.set({
    ...d,
    gross: d.gross + amount,
    verified: d.verified + (related ? 0n : amount),
    x402: d.x402 + (related || source !== 'x402' ? 0n : amount),
    payments: d.payments + 1,
  });
  const payerId = `${account}-${payer}`;
  const t = (await context.PayerTotal.get(payerId)) ?? {
    id: payerId,
    account,
    payer,
    amount: 0n,
    payments: 0,
    related: false,
    reasons: [] as string[],
    source,
  };
  context.PayerTotal.set({
    ...t,
    amount: t.amount + amount,
    payments: t.payments + 1,
    related: t.related || related,
    reasons: [...new Set([...t.reasons, ...reasons])],
  });
}

// EIP-3009 transferWithAuthorization (how x402 settles) marks the payer's authorization used just before
// the transfer itself. Consume it once so later unrelated transfers in the same tx are not x402.
indexer.onEvent({ contract: 'USDC', event: 'AuthorizationUsed' }, async ({ event, context }) => {
  context.Authorization.set({ id: authorizationId(event, low(event.params.authorizer)), nonce: low(event.params.nonce) });
});

indexer.onEvent({ contract: 'USDC', event: 'Transfer' }, async ({ event, context }) => {
  const from = low(event.params.from);
  const to = low(event.params.to);
  const value = event.params.value;
  const authId = authorizationId(event, from);
  const authorization = await context.Authorization.get(authId);
  if (authorization) context.Authorization.deleteUnsafe(authId);
  if (value === 0n) return;

  // Treasury funding: the issuer's wallet sending USDC to someone else (wash-trading detector input).
  // Transfers made inside Bondrail calls (stake through the factory, deposits into bonds) don't count.
  const viaBondrail = low(event.transaction.to ?? '') === FACTORY || !!(await context.Bond.get(to));
  const treasury = await context.Treasury.get(from);
  if (treasury && !viaBondrail && !(await context.Issuer.get(to))) {
    // The sender issued each of these accounts, so the recipient is linked to all of them.
    for (const account of treasury.accounts) {
      context.FundingEdge.set({
        id: `${rowId(event)}-${account}`,
        chainId: event.chainId,
        issuerAccount: account,
        sender: from,
        recipient: to,
        amount: value,
        timestamp: BigInt(event.block.timestamp),
        txHash: event.transaction.hash,
      });
      const id = `${account}-${to}`;
      const link = await context.FundingLink.get(id);
      context.FundingLink.set({ id, account, wallet: to, amount: (link?.amount ?? 0n) + value });
    }
  }

  // A transfer into an account is one of:
  //   x402      an EIP-3009 settlement: USDC emitted AuthorizationUsed for this sender in the same
  //             transaction, so the payer signed it (works before any bond exists)
  //   (skipped) the pull inside a Native collect(): its Revenue event attributes the proven payer
  //   transfer  anything else: booked on-chain by sweep(), shown as an unclassified inflow and never
  //             counted as verified revenue (anyone, including the issuer, can send USDC to an account)
  const issuer = await context.Issuer.get(to);
  if (!issuer || issuer.asset !== low(event.srcAddress) || (viaBondrail && !authorization)) return;
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
  if (authorization)
    await recordPayment(context, event, to, from, value, 'x402', id, [],
      x402Id(event, issuer.asset, from, authorization.nonce));
  else if (!issuer.project || low(event.transaction.to ?? '') !== issuer.project)
    await recordPayment(context, event, to, from, value, 'transfer', id, ['unclassified_inflow']);
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

indexer.onEvent({ contract: 'BondrailBond', event: 'Deposited' }, async ({ event, context }) => {
  const b = await bondOf(context, event);
  if (b) context.Bond.set({ ...b, raised: event.params.funded });
  log(context, event, low(event.srcAddress), 'Deposited', event.params.payer, event.params.amount);
});

indexer.onEvent({ contract: 'BondrailBond', event: 'Withdrawn' }, async ({ event, context }) => {
  const b = await bondOf(context, event);
  if (b) context.Bond.set({ ...b, raised: event.params.funded });
  log(context, event, low(event.srcAddress), 'Withdrawn', event.params.holder, event.params.amount);
});

indexer.onEvent({ contract: 'BondrailBond', event: 'Activated' }, async ({ event, context }) => {
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

indexer.onEvent({ contract: 'BondrailBond', event: 'PrincipalReleased' }, async ({ event, context }) => {
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

indexer.onEvent({ contract: 'BondrailBond', event: 'UndrawnRecovered' }, async ({ event, context }) => {
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

indexer.onEvent({ contract: 'BondrailBond', event: 'RevenueReceived' }, async ({ event, context }) => {
  const b = await bondOf(context, event);
  if (b) context.Bond.set({ ...b, revenueCollected: event.params.totalRevenue, pool: event.params.pool });
  log(context, event, low(event.srcAddress), 'RevenueReceived', '', event.params.amount);
});

indexer.onEvent({ contract: 'BondrailBond', event: 'TriggerChanged' }, async ({ event, context }) => {
  const b = await bondOf(context, event);
  if (b) context.Bond.set({ ...b, triggered: event.params.triggered });
  log(context, event, low(event.srcAddress), event.params.triggered ? 'Triggered' : 'TriggerRecovered', '', 0n);
});

indexer.onEvent({ contract: 'BondrailBond', event: 'DefaultRecorded' }, async ({ event, context }) => {
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

indexer.onEvent({ contract: 'BondrailBond', event: 'CollectionClosed' }, async ({ event, context }) => {
  const b = await bondOf(context, event);
  // Watched bonds enter Closing (2) for the evidence window; Native bonds close straight away (3).
  if (b) context.Bond.set({ ...b, phase: event.params.settleAfter > 0n ? 2 : 3, pool: event.params.pool });
  log(context, event, low(event.srcAddress), 'CollectionClosed', '', event.params.pool);
});

indexer.onEvent({ contract: 'BondrailBond', event: 'SettlementFinalized' }, async ({ event, context }) => {
  const b = await bondOf(context, event);
  if (b) context.Bond.set({ ...b, phase: 3, pool: event.params.pool });
  log(context, event, low(event.srcAddress), 'Settled', '', event.params.pool);
});

indexer.onEvent({ contract: 'BondrailBond', event: 'FundingCancelled' }, async ({ event, context }) => {
  const b = await bondOf(context, event);
  if (b) context.Bond.set({ ...b, phase: 4 });
  log(context, event, low(event.srcAddress), 'Cancelled', '', event.params.refundable);
});

indexer.onEvent({ contract: 'BondrailBond', event: 'Refunded' }, async ({ event, context }) => {
  log(context, event, low(event.srcAddress), 'Refunded', event.params.holder, event.params.amount);
});

indexer.onEvent({ contract: 'BondrailBond', event: 'Redeemed' }, async ({ event, context }) => {
  const b = await bondOf(context, event);
  if (b) context.Bond.set({ ...b, pool: b.pool - event.params.amount, redeemed: b.redeemed + event.params.amount });
  log(context, event, low(event.srcAddress), 'Redeemed', event.params.holder, event.params.amount);
});

indexer.onEvent({ contract: 'BondrailBond', event: 'Transfer' }, async ({ event, context }) => {
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

indexer.onEvent({ contract: 'BondrailCovenant', event: 'ObservationAccepted' }, async ({ event, context }) => {
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

indexer.onEvent({ contract: 'BondrailCovenant', event: 'CovenantDefault' }, async ({ event, context }) => {
  log(context, event, low(event.params.bond), 'CovenantDefault', '', 0n);
});

// ---------- portable credit registry (optional deployment) ----------
indexer.onEvent({ contract: 'BondrailCreditRegistry', event: 'BondRecorded' }, async ({ event, context }) => {
  const registry = low(event.srcAddress);
  context.CreditBond.set({ id: `${event.chainId}:${registry}:${low(event.params.bond)}`,
    chainId: event.chainId, registry, account: low(event.params.account), bond: low(event.params.bond),
    timestamp: BigInt(event.block.timestamp), txHash: event.transaction.hash });
});

indexer.onEvent({ contract: 'BondrailCreditRegistry', event: 'Attested' }, async ({ event, context }) => {
  const registry = low(event.srcAddress);
  const account = low(event.params.account);
  const key = `${event.chainId}:${registry}:${account}`;
  const id = `${key}:${event.params.nonce}`;
  context.CreditAttestation.set({ id, chainId: event.chainId, registry, account,
    signer: low(event.params.signer), periodStart: event.params.periodStart, periodEnd: event.params.periodEnd,
    attributedRevenue: event.params.attributedRevenue, excludedRevenue: event.params.excludedRevenue,
    distinctPayers: event.params.distinctPayers, topPayerShareBps: Number(event.params.topPayerShareBps),
    creditLine: event.params.creditLine, evidenceHash: low(event.params.evidenceHash), issuedAt: event.params.issuedAt,
    expiresAt: event.params.expiresAt, nonce: event.params.nonce,
    timestamp: BigInt(event.block.timestamp), txHash: event.transaction.hash });
  context.LatestCreditAttestation.set({ id: key, registry, account, attestation_id: id });
});

// Vault registry, share accounting and block-pinned history.
import "./vault";
