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
  adapter: 'Locked' | 'Watched';
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
  router?: string;
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
    description: 'Token launches with a committed share of every trading fee.',
    category: 'Launchpad',
    adapter: 'Locked',
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
export const money = (n: number, decimals = 0) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: decimals,
  }).format(n);
export const findMarket = (id: string) => markets.find((m) => m.id === id);
export const shortAddress = (s: string) => `${s.slice(0, 6)}…${s.slice(-4)}`;
