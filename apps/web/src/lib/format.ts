import type { Asset } from './protocol';

export const fmt = (n: number, a: Asset, digits = 2) =>
  /USD/i.test(a.symbol)
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: n !== 0 && Math.abs(n) < 1 ? 4 : digits }).format(n)
    : `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(n)} ${a.symbol}`;
