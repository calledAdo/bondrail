import { parseUnits } from 'viem';

/** Parse human asset units and integer day/bps inputs without rounding. Empty inputs disable the trigger. */
export function parseTriggerTerms(
  input: { triggerRevenue: string; triggerWindowDays: string; stepUpBps: string },
  decimals: number,
  revenueBps: number,
): { triggerRevenue: bigint; triggerWindowDays: number; stepUpBps: number } {
  const revenue = input.triggerRevenue.trim() || '0';
  const days = input.triggerWindowDays.trim() || '0';
  const step = input.stepUpBps.trim() || '0';
  if (!/^\d+(\.\d+)?$/.test(revenue) || (revenue.split('.')[1]?.length ?? 0) > decimals)
    throw new Error(`Trigger revenue must be nonnegative, with at most ${decimals} decimal places.`);
  const triggerRevenue = parseUnits(revenue, decimals);
  if (triggerRevenue >= 2n ** 256n) throw new Error('Trigger revenue exceeds the asset-unit limit.');
  if (!/^\d+$/.test(days) || !/^\d+$/.test(step))
    throw new Error('Trigger days and stepped-up share must be whole numbers.');
  const triggerWindowDays = Number(days);
  const stepUpBps = Number(step);
  if (triggerRevenue === 0n && triggerWindowDays === 0 && stepUpBps === 0)
    return { triggerRevenue, triggerWindowDays, stepUpBps };
  if (triggerRevenue <= 0n || triggerWindowDays < 1 || triggerWindowDays > 30)
    throw new Error('Set all three trigger fields: positive revenue and 1–30 complete UTC days, or all zero to disable.');
  if (!Number.isInteger(revenueBps) || revenueBps <= 0 || revenueBps > 5000 || stepUpBps <= revenueBps || stepUpBps > 5000)
    throw new Error('Stepped-up share must exceed the base share and be at most 5000 bps (50%).');
  return { triggerRevenue, triggerWindowDays, stepUpBps };
}
