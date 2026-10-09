export interface BondState {phase:number;now:bigint;fundingDeadline:bigint;maturity:bigint;secondReleaseDeadline:bigint;undrawnPrincipal:bigint;settleAfter:bigint;freeReceipts:bigint}
export type Operation='cancelFunding'|'expireUndrawn'|'closeBondAtMaturity'|'sweep'|'finalizeSettlement';
/** One mutation per bond per cycle. Refresh state after every confirmed transaction. */
export function nextOperation(s:BondState):Operation|undefined {
  if(s.phase===0&&s.now>=s.fundingDeadline)return 'cancelFunding';
  if(s.phase===1){if(s.now>=s.maturity)return 'closeBondAtMaturity';if(s.undrawnPrincipal>0n&&s.now>=s.secondReleaseDeadline)return 'expireUndrawn';if(s.freeReceipts>0n)return 'sweep';}
  if(s.phase===2&&s.now>=s.settleAfter)return 'finalizeSettlement';return undefined;
}
