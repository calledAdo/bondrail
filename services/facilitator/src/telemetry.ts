import type { GasEvent } from './settlement.js';

/** Optional operator-owned alert receiver. Never include signatures, keys or RPC URLs. */
export function lowBalanceHook(url?: string, fetchFn = fetch) {
  if (!url) return undefined;
  const target = new URL(url);
  if (target.protocol !== 'https:' || target.username || target.password) throw new Error('Invalid gas alert URL');
  return async (event: GasEvent) => {
    const response = await fetchFn(target, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event), signal: AbortSignal.timeout(5000), redirect: 'error' });
    if (!response.ok) throw new Error('gas_alert_delivery_failed');
  };
}
