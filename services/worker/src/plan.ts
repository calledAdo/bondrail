export interface BondState {
  phase: number;
  now: bigint;
  fundingDeadline: bigint;
  maturity: bigint;
  secondReleaseDeadline: bigint;
  undrawnPrincipal: bigint;
  settleAfter: bigint;
  freeReceipts: bigint;
  trigger?: {
    triggerWindowDays: number;
    activationTime: bigint;
    defaultedAt: bigint;
    lastTriggerCheckDay: bigint;
  };
}
export type Operation =
  | 'cancelFunding'
  | 'expireUndrawn'
  | 'closeBondAtMaturity'
  | 'sweep'
  | 'checkTrigger'
  | 'finalizeSettlement';
/** One mutation per bond per cycle. Refresh state after every confirmed transaction. */
export function nextOperation(s: BondState): Operation | undefined {
  if (s.phase === 0 && s.now >= s.fundingDeadline) return 'cancelFunding';
  if (s.phase === 1) {
    if (s.now >= s.maturity) return 'closeBondAtMaturity';
    if (s.undrawnPrincipal > 0n && s.now >= s.secondReleaseDeadline) return 'expireUndrawn';
    const today = s.now / 86_400n;
    const t = s.trigger;
    if (t && t.triggerWindowDays > 0 && t.defaultedAt === 0n
        && today >= t.activationTime / 86_400n + 1n + BigInt(t.triggerWindowDays)
        && today > t.lastTriggerCheckDay) return 'checkTrigger';
    if (s.freeReceipts > 0n) return 'sweep';
  }
  if (s.phase === 2 && s.now >= s.settleAfter) return 'finalizeSettlement';
  return undefined;
}
