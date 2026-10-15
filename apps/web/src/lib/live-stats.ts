/** Public Envio response; amounts are base-unit strings, phases and counts are numbers. */
export type LiveIndexerData = {
  Issuer: { id: string; asset: string; grossRevenue: string; toInvestors: string; payments: number }[];
  Bond: { phase: number }[];
  Payment: { account: string; payer: string; amount: string; source: string; timestamp: string; txHash: string }[];
};

export const liveStatsQuery = `{
  Issuer { id asset grossRevenue toInvestors payments }
  Bond { phase }
  Payment(order_by: { timestamp: desc }, limit: 24, where: { related: { _eq: false } }) {
    account payer amount source timestamp txHash
  }
}`;

/** Dollar totals use only the deployment's six-decimal USD asset; counts cover all accounts. */
export function aggregateLiveStats(data: LiveIndexerData, usdAsset: string) {
  if (!usdAsset) throw new Error('USD asset not configured');
  const issuers = data.Issuer.filter(i => i.asset.toLowerCase() === usdAsset.toLowerCase());
  const usdAccounts = new Set(issuers.map(i => i.id.toLowerCase()));
  const usd = (value: bigint | string) => Number(value) / 1e6;
  return {
    revenue: usd(issuers.reduce((sum, i) => sum + BigInt(i.grossRevenue), 0n)),
    toInvestors: usd(issuers.reduce((sum, i) => sum + BigInt(i.toInvestors), 0n)),
    payments: data.Issuer.reduce((sum, i) => sum + i.payments, 0),
    accounts: data.Issuer.length,
    activeBonds: data.Bond.filter(b => b.phase === 1 || b.phase === 2).length,
    recent: data.Payment.filter(p => usdAccounts.has(p.account.toLowerCase())).map(p => ({
      payer: p.payer, amount: usd(p.amount), source: p.source,
      timestamp: Number(p.timestamp), txHash: p.txHash,
    })),
  };
}

export type LiveStats = ReturnType<typeof aggregateLiveStats>;
