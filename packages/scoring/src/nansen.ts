export type NansenMethod = "labels" | "related-wallets" | "counterparties";
export interface NansenEvidence {
  status: "available" | "unavailable" | "no_labels";
  chain: "monad";
  fetchedAt: string;
  method: NansenMethod;
  address: string;
  reason?: string;
  data: unknown[];
  truncated: boolean;
}
const validAddress = /^0x[0-9a-fA-F]{40}$/;
/** Server-side only. Does not infer same ownership from a generic counterparty relationship. */
export class NansenClient {
  private cache = new Map<string, { expires: number; value: NansenEvidence }>();
  private requests = 0;
  constructor(private options: { apiKey?: string; maxRequests?: number; fetch?: typeof fetch; ttlMs?: number }) {}

  async inspect(method: NansenMethod, address: string, chainId: number, period?: { from: string; to: string }): Promise<NansenEvidence> {
    if (!validAddress.test(address)) throw new Error("Invalid wallet address");
    const base = { method, address: address.toLowerCase(), chain: "monad" as const, fetchedAt: new Date().toISOString(), data: [], truncated: false };
    if (chainId !== 143) return { ...base, status: "unavailable", reason: "Nansen Monad testnet coverage is not verified; no cross-network substitution is performed." };
    if (!this.options.apiKey) return { ...base, status: "unavailable", reason: "NANSEN_API_KEY is not configured" };
    if (method === "counterparties" && !period) throw new Error("Counterparty requests require an explicit time period");
    const body = {
      chain: "monad", ...(method === "related-wallets" ? { wallet_address: base.address } : { address: base.address }),
      pagination: { page: 1, per_page: 20 },
      ...(method === "counterparties" ? { date: { from: period!.from, to: period!.to }, group_by: "wallet", source_input: "all" } : {}),
    };
    const key = JSON.stringify({ method, body });
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;
    if (this.requests >= (this.options.maxRequests ?? 20)) return { ...base, status: "unavailable", reason: "Configured request budget reached" };
    this.requests++;
    try {
      const response = await (this.options.fetch ?? fetch)(`https://api.nansen.ai/api/v1/profiler/address/${method}`, {
        method: "POST", headers: { "Content-Type": "application/json", apikey: this.options.apiKey },
        body: JSON.stringify(body), signal: AbortSignal.timeout(10_000), redirect: "error",
      });
      if (!response.ok) return { ...base, status: "unavailable", reason: `Provider returned HTTP ${response.status}` };
      const json = await response.json() as { data?: unknown[]; pagination?: { is_last_page?: boolean; total_pages?: number } };
      if (!Array.isArray(json.data)) return { ...base, status: "unavailable", reason: "Unexpected provider response schema" };
      const value: NansenEvidence = { ...base, status: json.data.length ? "available" : "no_labels", data: json.data, truncated: json.pagination?.is_last_page === false || (json.pagination?.total_pages ?? 1) > 1 };
      this.cache.set(key, { value, expires: Date.now() + (this.options.ttlMs ?? 300_000) });
      return value;
    } catch {
      return { ...base, status: "unavailable", reason: "Provider request failed or timed out" };
    }
  }
}
