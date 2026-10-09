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
  adapter: 'Native' | 'Locked' | 'Watched';
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
    id: 'classic',
    name: 'PumpLab Classic',
    symbol: 'CLAB-01',
    description: 'An existing launchpad whose owner key is held by a FeeGuard while the bond is live.',
    category: 'Launchpad',
    adapter: 'Locked',
    phase: 'Active',
    raised: 6000,
    target: 6000,
    released: 3000,
    undrawn: 3000,
    recovery: 0,
    revenue: 410,
    stake: 1000,
    share: 25,
    cap: 7200,
    firstRelease: 50,
    term: 60,
    observed: 2100,
    eligible: 1640,
    adjusted: 1310,
    days: 11,
    history: [22, 30, 28, 41, 39, 47, 55, 52, 66, 71, 80],
    accent: 'amber',
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
export const money = (n: number, decimals = 0) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: n !== 0 && Math.abs(n) < 1 ? Math.max(decimals, 4) : decimals,
  }).format(n);
export const findMarket = (id: string) => markets.find((m) => m.id === id);
export const shortAddress = (s: string) => `${s.slice(0, 6)}…${s.slice(-4)}`;
