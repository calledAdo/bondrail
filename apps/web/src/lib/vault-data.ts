import { formatUnits, parseUnits } from 'viem';

export const vaultDisclosure = 'Anyone can create a vault. Bondrail lists every vault created through its factory but does not endorse curators or strategies.';
export function isTeamVault(v: { address: string; owner: string }, d: { vault?: string; vaultFactory?: string; operator?: string }) {
  return !!d.vaultFactory && !!d.operator && v.address.toLowerCase() === d.vault?.toLowerCase()
    && v.owner.toLowerCase() === d.operator.toLowerCase();
}
/** Compare exact asset units; display rounds upward so a loss above 2% never displays as 2%. */
export function depositGap(assets: bigint, exitAssets: bigint) {
  const loss = assets - exitAssets;
  if (assets <= 0n || loss <= 0n) return undefined;
  return { exitAssets, percent: formatUnits((loss * 10_000n + assets - 1n) / assets, 2), requiresAcknowledgement: loss * 100n > assets * 2n };
}

export function vaultAmount(text: string, decimals: number): bigint | undefined {
  if (!/^\d+(\.\d+)?$/.test(text) || (text.split('.')[1]?.length ?? 0) > decimals) return undefined;
  try { return parseUnits(text, decimals); } catch { return undefined; }
}
const min = (...values: bigint[]) => values.reduce((a, b) => a < b ? a : b);
const positive = (n: bigint) => n > 0n ? n : 0n;
/** Mirrors allocation-time rules, with the idle requirement rounded UP as in the contract. */
export function allocationHeadroom(p: { nav: bigint; idle: bigint; holdingValue: bigint; cap: bigint; buffer: bigint; holdings: number; maxBonds: bigint; tracked: boolean; raiseRemaining: bigint }) {
  const concentration = positive(p.nav * p.cap / 10_000n - p.holdingValue);
  const bufferRequired = (p.nav * p.buffer + 9999n) / 10_000n;
  const liquidity = positive(p.idle - bufferRequired);
  const slotAvailable = p.tracked || BigInt(p.holdings) < p.maxBonds;
  return { concentration, bufferRequired, liquidity, slotAvailable, available: slotAvailable ? min(concentration, liquidity, positive(p.raiseRemaining)) : 0n };
}
export function vaultInputError(p: { connected: boolean; correctNetwork: boolean; amount?: bigint; balance?: bigint; preview?: bigint; max?: bigint; deposit: boolean; closed?: boolean; readError?: boolean }) {
  if (!p.connected) return 'Connect a wallet to continue. Passkeys and browser wallets are supported.';
  if (!p.correctNetwork) return 'Switch your wallet to the configured network to continue.';
  if (p.readError) return 'Could not refresh balances or preview. Retry before continuing.';
  if (p.deposit && p.closed) return 'Closed to deposits: the vault currently reports a zero deposit limit.';
  if (p.amount === undefined) return 'Enter a valid amount with no extra decimal places.';
  if (p.amount <= 0n) return 'Enter an amount greater than zero.';
  if (p.balance === undefined || p.preview === undefined || p.max === undefined) return 'Reading your balance and preview…';
  if (p.deposit && p.amount > p.balance) return 'Insufficient asset balance.';
  if (p.preview === 0n) return p.deposit ? 'This amount rounds to zero shares. Increase the deposit.' : 'This amount rounds to zero. Increase the withdrawal.';
  if (p.amount > p.max) return p.deposit ? 'This amount exceeds the vault’s deposit limit.' : 'This exceeds what you can withdraw now. The rest is invested until bonds repay.';
  return undefined;
}

export type VaultSnapshot = { id: string; vault: string; day: number; timestamp: string; block: string; entryPrice: string; exitPrice: string; nav: string; entryNav: string; idle: string; totalSupply: string };
export type IndexedVaultPosition = { id: string; vault: string; holder: string; shares: string; costBasis: string; deposited: string; withdrawn: string };
