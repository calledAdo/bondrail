export type Phase = 'Funding' | 'Active' | 'Closing' | 'Closed' | 'Cancelled';
export type PayerRow = {
  payer: string;
  amount: number;
  payments: number;
  related: boolean;
  reasons: string[];
  source: string;
};
export type Market = {
  id: string;
  name: string;
  symbol: string;
  description: string;
  category: string;
  adapter: 'Native' | 'Watched';
  /** Symbol of the token the bond raises and repays in (the account's asset). Defaults to USDC. */
  unit?: string;
  /** Native fee floor while Active, in bps of gross (0 = none). */
  minFeeBps?: number;
  phase: Phase;
  raised: number;
  target: number;
  released: number;
  undrawn: number;
  recovery: number;
  revenue: number;
  stake: number;
  share: number;
  cap: number;
  firstRelease: 25 | 50;
  term: number;
  observed: number;
  eligible: number;
  adjusted: number;
  days: number;
  history: number[];
  accent: string;
  defaulted: boolean;
  /** true only for values read from the chain and the indexer */
  live?: boolean;
  bond?: string;
  account?: string;
  /** Native only: the disclosed reviewer approved the project's code. */
  nativeApproved?: boolean;
  /** On-chain credit history kept by the SliceAccount since its first payment. */
  credit?: { cumulative: number; payments: number; uniquePayers: number; since: number };
  claimName?: string;
  daily?: { day: number; raw: number; verified: number }[];
  payers?: PayerRow[];
  payments?: number;
  backingPerToken?: number;
  pool?: number;
  supply?: number;
  checks?: { result: number; at: number; txHash: string }[];
  /** Watched: seconds the covenant has seen only Unknown reports (0 = not dark). */
  darkFor?: number;
  /** Watched: the covenant currently refuses deposits (violation, dark for an hour, or defaulted). */
  depositsPaused?: boolean;
  /** Watched: verified x402 revenue in the last 24 h vs the prior 7-day daily average (null = no baseline). */
  revenueDrop?: { last24h: number; dailyAverage: number } | null;
};
/** Deliberately synthetic scenario fixtures; never use for chain accounting or authorizations. */
export const markets: Market[] = [
  {
    id: 'pumplab',
    name: 'PumpLab',
    symbol: 'PUMP-01',
    description: 'A launchpad built on Slice: every trading fee is pulled through its SliceAccount.',
    category: 'Launchpad',
    adapter: 'Native',
    phase: 'Active',
    raised: 10000,
    target: 10000,
    released: 5000,
    undrawn: 5000,
    recovery: 0,
    revenue: 960,
    stake: 2000,
    share: 20,
    cap: 6000,
    firstRelease: 50,
    term: 90,
    observed: 4800,
    eligible: 4320,
    adjusted: 3280,
    days: 14,
    history: [18, 30, 24, 42, 37, 50, 47, 68, 52, 78, 63, 90, 73, 100],
    accent: 'blue',
    defaulted: false,
  },
  {
    id: 'oracle-agent',
    name: 'Oracle Agent',
    symbol: 'ORCL-01',
    description: 'Paid API answers, one request at a time. Revenue routing is monitored.',
    category: 'AI services',
    adapter: 'Watched',
    phase: 'Funding',
    raised: 5700,
    target: 8000,
    released: 0,
    undrawn: 0,
    recovery: 0,
    revenue: 0,
    stake: 1600,
    share: 15,
    cap: 9600,
    firstRelease: 25,
    term: 60,
    observed: 2140,
    eligible: 1680,
    adjusted: 1240,
    days: 9,
    history: [16, 22, 18, 30, 26, 42, 38, 56, 74],
    accent: 'teal',
    defaulted: false,
  },
];
/** USD formatting; sub-dollar testnet amounts keep four decimals so they don't read as $0.00. */
/** Dollar format for USD stablecoins (the default); `1.25 WETH` style for any other bond asset. */
export const money = (n: number, decimals = 0, unit = 'USDC') => {
  const digits = n !== 0 && Math.abs(n) < 1 ? Math.max(decimals, 4) : decimals;
  if (/USD/i.test(unit))
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: digits }).format(n);
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: Math.max(digits, 4) }).format(n)} ${unit}`;
};
export const findMarket = (id: string) => markets.find((m) => m.id === id);
export const shortAddress = (s: string) => `${s.slice(0, 6)}…${s.slice(-4)}`;
