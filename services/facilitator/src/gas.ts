import { parseGwei } from 'viem';

export interface GasPolicy {
  marginBps: number;
  maxGas: bigint;
  maxFeePerGas: bigint;
  priorityFeePerGas: bigint;
  lowBalanceSettlements: number;
  stuckSeconds: number;
}

export const defaultGasPolicy: GasPolicy = {
  marginBps: 11_500, maxGas: 500_000n, maxFeePerGas: parseGwei('150'),
  priorityFeePerGas: parseGwei('2'), lowBalanceSettlements: 10, stuckSeconds: 30,
};

export function validateGasPolicy(p: GasPolicy): GasPolicy {
  if (!Number.isSafeInteger(p.marginBps) || p.marginBps < 10_000 || p.marginBps > 13_000 ||
      p.maxGas < 21_000n || p.maxGas > 1_000_000n || p.maxFeePerGas <= 0n ||
      p.priorityFeePerGas < 0n || p.priorityFeePerGas > p.maxFeePerGas ||
      !Number.isSafeInteger(p.lowBalanceSettlements) || p.lowBalanceSettlements < 1 ||
      !Number.isSafeInteger(p.stuckSeconds) || p.stuckSeconds < 10)
    throw new Error('invalid_gas_policy');
  return p;
}

export function gasPolicyFromEnv(env = process.env): GasPolicy {
  const gwei = (name: string, fallback: bigint) => {
    const v = env[name];
    if (v === undefined) return fallback;
    if (!/^\d+(\.\d{1,9})?$/.test(v)) throw new Error(`Invalid ${name}`);
    return parseGwei(v);
  };
  return validateGasPolicy({
    marginBps: Number(env.FACILITATOR_GAS_MARGIN_BPS ?? defaultGasPolicy.marginBps),
    maxGas: BigInt(env.FACILITATOR_MAX_GAS ?? defaultGasPolicy.maxGas),
    maxFeePerGas: gwei('FACILITATOR_MAX_FEE_GWEI', defaultGasPolicy.maxFeePerGas),
    priorityFeePerGas: gwei('FACILITATOR_PRIORITY_FEE_GWEI', defaultGasPolicy.priorityFeePerGas),
    lowBalanceSettlements: Number(env.FACILITATOR_LOW_BALANCE_SETTLEMENTS ?? defaultGasPolicy.lowBalanceSettlements),
    stuckSeconds: Number(env.FACILITATOR_STUCK_SECONDS ?? defaultGasPolicy.stuckSeconds),
  });
}

export function gasLimit(estimate: bigint, p: GasPolicy): bigint {
  if (estimate <= 0n) throw new Error('invalid_gas_estimate');
  const gas = (estimate * BigInt(p.marginBps) + 9_999n) / 10_000n;
  // Refuse rather than silently clipping a transaction into an out-of-gas revert.
  if (gas > p.maxGas) throw new Error('gas_limit_exceeded');
  return gas;
}

export interface Fees { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }
export function feesForBlock(baseFee: bigint | null | undefined, p: GasPolicy, previous?: Fees): Fees {
  if (baseFee == null || baseFee < 0n) throw new Error('base_fee_unavailable');
  const bump = (v: bigint) => (v * 9n + 7n) / 8n + 1n; // >12.5%, including zero tips
  const maxPriorityFeePerGas = previous
    ? max(p.priorityFeePerGas, bump(previous.maxPriorityFeePerGas)) : p.priorityFeePerGas;
  const minimum = baseFee + maxPriorityFeePerGas;
  if (minimum > p.maxFeePerGas) throw new Error('gas_fee_cap_exceeded');
  // Ten percent base-fee headroom; the effective price remains base + tip.
  let maxFeePerGas = min((baseFee * 110n + 99n) / 100n + maxPriorityFeePerGas, p.maxFeePerGas);
  if (previous) maxFeePerGas = max(maxFeePerGas, bump(previous.maxFeePerGas));
  if (maxFeePerGas > p.maxFeePerGas) throw new Error('gas_fee_cap_exceeded');
  return { maxFeePerGas, maxPriorityFeePerGas };
}

const max = (a: bigint, b: bigint) => a > b ? a : b;
const min = (a: bigint, b: bigint) => a < b ? a : b;
