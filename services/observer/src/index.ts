import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { privateKeyToAccount } from "viem/accounts";
import { type Hex } from "viem";
import {
  address,
  PARSER_VERSION,
  digest,
  observationDomain,
  observationTypes,
  parseOffer,
  policyHash,
  typedObservation,
  type WatchPolicy,
  type SignedObservation,
  type Observation,
} from "./protocol.js";
import type { DurableStore } from "./store.js";
import { fetchOffer, validateURL } from "./fetch.js";

export async function loadRegistry(
  path: string,
  local = false,
): Promise<WatchPolicy[]> {
  const data: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!Array.isArray(data) || data.length === 0 || data.length > 32)
    throw new Error("Registry requires 1–32 immutable policies");
  const ids = new Set();
  for (const p of data as WatchPolicy[]) {
    if (
      !/^[a-z0-9-]{1,64}$/.test(p.id) ||
      ids.has(p.id) ||
      ![10143, 31337].includes(p.chainId) ||
      !/^\d+$/.test(p.chainSelector) ||
      ![p.covenant, p.bond, p.asset, p.expectedPayTo].every(address) ||
      p.method !== "GET" ||
      p.network !== `eip155:${p.chainId}` ||
      !/^(0|[1-9][0-9]*)$/.test(p.amount) ||
      BigInt(p.amount) <= 0n ||
      p.parserVersion !== PARSER_VERSION ||
      p.epochSeconds !== 30 ||
      p.freshnessSeconds !== 90 ||
      !Number.isSafeInteger(p.maxTimeoutSeconds) ||
      p.maxTimeoutSeconds < 1 ||
      p.maxTimeoutSeconds > 300
    )
      throw new Error("Invalid watch policy");
    if (
      [p.covenant, p.bond, p.asset, p.expectedPayTo].some((v) =>
        /^0x0{40}$/i.test(v),
      )
    )
      throw new Error("Replace zero-address registry placeholders");
    validateURL(p.url, local && p.chainId === 31337);
    if (
      !p.headers ||
      Object.entries(p.headers).some(
        ([k, v]) =>
          !["accept", "x-slice-probe"].includes(k.toLowerCase()) ||
          typeof v !== "string" ||
          v.length > 256 ||
          /[\r\n]/.test(v),
      )
    )
      throw new Error("Unsupported request headers");
    ids.add(p.id);
  }
  return data as WatchPolicy[];
}
export class Observer {
  private signer;
  constructor(
    private policies: readonly WatchPolicy[],
    private store: DurableStore,
    signerKey: Hex,
    private local = false,
    private fetcher = fetchOffer,
    private now = () => Math.floor(Date.now() / 1000),
  ) {
    this.signer = privateKeyToAccount(signerKey);
  }
  get signerAddress() {
    return this.signer.address;
  }
  async observe(watchId: string, epoch: number): Promise<SignedObservation> {
    const p = this.policies.find((x) => x.id === watchId);
    if (!p) throw new Error("Unknown watch");
    if (!Number.isSafeInteger(epoch) || epoch !== Math.floor(this.now() / 30))
      throw new Error("Only current epoch may be observed");
    const key = `observation:${p.chainId}:${p.covenant}:${p.bond}:${policyHash(p)}:${epoch}`;
    const old = await this.store.get(key);
    const awaitCommitted = async () => {
      for (let i = 0; i < 160; i++) {
        const raw = await this.store.get(key);
        if (raw) {
          const v = JSON.parse(raw) as { signed?: SignedObservation };
          if (v.signed) return v.signed;
        }
        await delay(50);
      }
      throw new Error("Observation interrupted; wait for next epoch");
    };
    if (old) {
      const v = JSON.parse(old) as { signed?: SignedObservation };
      if (v.signed) return v.signed;
      return awaitCommitted();
    }
    const pending = JSON.stringify({ state: "fetching" });
    if (!(await this.store.cas(key, null, pending))) return awaitCommitted();
    let response: { status: number; header?: string };
    try {
      response = await this.fetcher(p, this.local && p.chainId === 31337);
    } catch {
      response = { status: 0 };
    }
    const observedAt = this.now();
    if (Math.floor(observedAt / 30) !== epoch)
      throw new Error("Epoch changed while observing");
    const result = parseOffer(response.status, response.header, p);
    const observation: Observation = {
      bond: p.bond,
      policyHash: policyHash(p),
      epoch: String(epoch),
      observedAt: String(observedAt),
      expiresAt: String(observedAt + 90),
      result: result.result,
      observedPayTo: result.observedPayTo,
      offerHash: result.offerHash,
      evidenceHash: digest({
        policyHash: policyHash(p),
        epoch,
        status: response.status,
        ...result,
      }),
    };
    const signature = await this.signer.signTypedData({
      domain: observationDomain(p),
      types: observationTypes,
      primaryType: "Observation",
      message: typedObservation(observation),
    });
    const signed = { observation, signature, signer: this.signer.address };
    if (!(await this.store.cas(key, pending, JSON.stringify({ signed }))))
      throw new Error("Observation commit failed");
    return signed;
  }
}
