// Pure event accounting, shared with the local log adapter. No state reads or time sampling.
export const ZERO = '0x0000000000000000000000000000000000000000';
export const PRICE_SCALE = 10n ** 18n;
export const emptyTotals = () => ({ deposited: 0n, withdrawn: 0n, depositedShares: 0n, withdrawnShares: 0n,
  allocated: 0n, collected: 0n, raiseWithdrawn: 0n, income: 0n });
export const emptyPrice = () => ({ realizedPrice: undefined as bigint | undefined,
  realizedPriceKind: undefined as string | undefined, realizedPriceTimestamp: undefined as bigint | undefined });
export type AccountingEvent = { kind: string; timestamp: bigint; assets?: bigint; shares?: bigint;
  from?: string; to?: string; newIncome?: bigint; lockedIncome?: bigint };
export function eventTotals(e: AccountingEvent) {
  const totals = emptyTotals();
  if (e.kind === 'Deposit') { totals.deposited = e.assets!; totals.depositedShares = e.shares!; }
  if (e.kind === 'Withdraw') { totals.withdrawn = e.assets!; totals.withdrawnShares = e.shares!; }
  if (e.kind === 'Allocated') totals.allocated = e.assets!;
  if (e.kind === 'Collected') totals.collected = e.assets!;
  if (e.kind === 'RaiseWithdrawn') totals.raiseWithdrawn = e.assets!;
  if (e.kind === 'IncomeCheckpointed') totals.income = e.newIncome!;
  return totals;
}
export function addTotals<T extends ReturnType<typeof emptyTotals>>(old: T, delta: ReturnType<typeof emptyTotals>): T {
  const next = { ...old };
  for (const key of Object.keys(delta) as (keyof typeof delta)[]) next[key] = old[key] + delta[key];
  return next;
}
export function eventPrice(e: AccountingEvent) {
  return (e.kind === 'Deposit' || e.kind === 'Withdraw') && e.shares! > 0n
    ? { realizedPrice: e.assets! * PRICE_SCALE / e.shares!, realizedPriceKind: e.kind, realizedPriceTimestamp: e.timestamp }
    : undefined;
}
export function supplyChange(e: AccountingEvent) {
  if (e.kind !== 'Transfer' || e.from === e.to) return 0n;
  return e.from === ZERO ? e.shares! : e.to === ZERO ? -e.shares! : 0n;
}
export function emptyHolding(vault: string, bond: string) {
  return { id: `${vault}-${bond}`, vault, bond, claims: 0n, costBasis: 0n, allocated: 0n, collected: 0n, raiseWithdrawn: 0n, active: false };
}
export function updateHolding(old: ReturnType<typeof emptyHolding>, kind: string, assets: bigint) {
  const h = { ...old };
  if (kind === 'Allocated') {
    h.claims += assets; h.costBasis += assets; h.allocated += assets; h.active = true;
  } else if (kind === 'RaiseWithdrawn') {
    // Funding claims mint 1:1 and cannot transfer, so this is the contract's exact pro-rata basis.
    if (!h.active || assets > h.claims) throw new Error('Vault holding history incomplete; reindex from deployment');
    h.costBasis -= h.claims === 0n ? 0n : h.costBasis * assets / h.claims;
    h.claims -= assets; h.raiseWithdrawn += assets; h.active = h.claims > 0n;
  } else if (kind === 'Collected') {
    if (!h.active) throw new Error('Vault holding history incomplete; reindex from deployment');
    // collect() always removes the entire holding, including claims donated in Active/Closed.
    h.claims = 0n; h.costBasis = 0n; h.collected += assets; h.active = false;
  }
  return h;
}
