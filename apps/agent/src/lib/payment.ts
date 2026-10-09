import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
} from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import {
  address,
  canonical,
  decodeBase64Json,
  digest,
  isRecord,
} from "@slice/observer/protocol";
import type { DurableStore } from "@slice/observer/store";
import type { AgentConfig, AgentEnvironment } from "./config.js";

export interface PaymentRecord {
  state: "processing" | "model_failed" | "settlement_pending" | "complete";
  binding: string;
  payloadHash: string;
  requirements: PaymentRequirements;
  payer: string;
  nonce: string;
  resource: string;
  createdAt: string;
  answer?: string;
  settlement?: SettleResponse;
}
export interface PaymentBackend {
  verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<{ isValid: boolean; payer?: string }>;
  settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<SettleResponse>;
  answer(question: string): Promise<string>;
}
export function requirements(
  env: AgentEnvironment,
  config: AgentConfig,
): PaymentRequirements {
  return {
    scheme: "exact",
    network: `eip155:${env.chainId}`,
    asset: env.asset,
    amount: "10000",
    payTo: config.payTo,
    maxTimeoutSeconds: 300,
    extra: { name: "USDC", version: "2", assetTransferMethod: "eip3009" },
  };
}
export function resourceURL(env: AgentEnvironment, question: string) {
  const u = new URL("/api/oracle", env.publicURL);
  u.searchParams.set("question", question);
  return u.toString();
}
export function decodePayment(header: string): {
  payload: PaymentPayload;
  payer: string;
  nonce: string;
} {
  const p = decodeBase64Json(header);
  if (
    !isRecord(p) ||
    p.x402Version !== 2 ||
    !isRecord(p.accepted) ||
    !isRecord(p.payload) ||
    !isRecord(p.payload.authorization) ||
    typeof p.payload.signature !== "string" ||
    !/^0x[0-9a-fA-F]{130}$/.test(p.payload.signature)
  )
    throw new Error("Malformed payment");
  const a = p.payload.authorization;
  if (
    !address(a.from) ||
    !address(a.to) ||
    typeof a.nonce !== "string" ||
    !/^0x[0-9a-fA-F]{64}$/.test(a.nonce) ||
    typeof a.value !== "string" ||
    !/^\d+$/.test(a.value)
  )
    throw new Error("Malformed authorization");
  return {
    payload: p as unknown as PaymentPayload,
    payer: a.from.toLowerCase(),
    nonce: a.nonce.toLowerCase(),
  };
}
export function paymentKey(
  chainId: number,
  asset: string,
  payer: string,
  nonce: string,
) {
  return `payment:${digest({ chainId, asset: asset.toLowerCase(), payer: payer.toLowerCase(), nonce: nonce.toLowerCase() })}`;
}
function response(
  status: number,
  data: unknown,
  headers: Record<string, string> = {},
) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store", ...headers },
  });
}
function completed(record: PaymentRecord) {
  return response(
    200,
    { answer: record.answer, payment: record.settlement },
    {
      "PAYMENT-RESPONSE": Buffer.from(
        JSON.stringify(record.settlement),
      ).toString("base64"),
    },
  );
}
export async function handlePaidRequest(
  question: string,
  header: string | null,
  env: AgentEnvironment,
  config: AgentConfig,
  store: DurableStore,
  backend: PaymentBackend,
): Promise<Response> {
  const required = requirements(env, config),
    resource = resourceURL(env, question);
  const challenge = () =>
    response(
      402,
      { error: "payment_required" },
      {
        "PAYMENT-REQUIRED": Buffer.from(
          JSON.stringify({
            x402Version: 2,
            resource: {
              url: resource,
              description: "Bounded Kimi answer",
              mimeType: "application/json",
            },
            accepts: [required],
          }),
        ).toString("base64"),
      },
    );
  if (!header) return challenge();
  let decoded: ReturnType<typeof decodePayment>;
  try {
    decoded = decodePayment(header);
  } catch {
    return response(400, { error: "malformed_payment" });
  }
  const { payload, payer, nonce } = decoded,
    key = paymentKey(env.chainId, env.asset, payer, nonce);
  const binding = digest({ resource, question }),
    payloadHash = digest(payload),
    old = await store.get(key);
  if (old) {
    const record = JSON.parse(old) as PaymentRecord;
    if (record.binding !== binding || record.payloadHash !== payloadHash)
      return response(409, {
        error: "authorization_already_bound_to_another_request",
      });
    if (record.state === "complete") return completed(record);
    return response(
      record.state === "model_failed" ? 502 : 202,
      {
        status: record.state,
        paymentKey: key,
        message:
          "Retry this same signed request. Do not issue a new authorization while settlement is unresolved.",
      },
      { "Retry-After": "5" },
    );
  }
  if (!env.apiKey)
    return response(503, { error: "model_credentials_unavailable" });
  if (
    canonical(payload.accepted) !== canonical(required) ||
    (payload.resource && payload.resource.url !== resource)
  )
    return challenge();
  const authorization = payload.payload.authorization as Record<
    string,
    unknown
  >;
  if (
    String(authorization.to).toLowerCase() !== required.payTo.toLowerCase() ||
    authorization.value !== required.amount
  )
    return challenge();
  const verified = await backend.verify(payload, required);
  if (!verified.isValid || verified.payer?.toLowerCase() !== payer)
    return challenge();
  let record: PaymentRecord = {
    state: "processing",
    binding,
    payloadHash,
    requirements: required,
    payer,
    nonce,
    resource,
    createdAt: new Date().toISOString(),
  };
  let raw = JSON.stringify(record);
  if (!(await store.cas(key, null, raw)))
    return response(
      202,
      { status: "processing", paymentKey: key },
      { "Retry-After": "5" },
    );
  try {
    record = {
      ...record,
      answer: await backend.answer(question),
      state: "settlement_pending",
    };
  } catch {
    record = { ...record, state: "model_failed" };
    await store.cas(key, raw, JSON.stringify(record));
    return response(502, { error: "model_request_failed", charged: false });
  }
  const pending = JSON.stringify(record);
  if (!(await store.cas(key, raw, pending)))
    throw new Error("Payment journal conflict");
  raw = pending;
  // Journal the answer before settlement. A timeout leaves durable reconciliation work; never re-run the model or create another nonce.
  try {
    const settlement = await backend.settle(payload, required);
    if (
      !settlement.success ||
      !/^0x[0-9a-fA-F]{64}$/.test(settlement.transaction) ||
      settlement.network !== required.network ||
      settlement.payer?.toLowerCase() !== payer
    )
      return response(
        202,
        { status: "settlement_pending", paymentKey: key },
        { "Retry-After": "5" },
      );
    record = { ...record, state: "complete", settlement };
    if (!(await store.cas(key, raw, JSON.stringify(record))))
      throw new Error("Payment journal conflict");
    return completed(record);
  } catch {
    return response(
      202,
      {
        status: "settlement_pending",
        paymentKey: key,
        message:
          "Payment outcome needs receipt reconciliation; reuse the same authorization.",
      },
      { "Retry-After": "5" },
    );
  }
}
export function realBackend(env: AgentEnvironment): PaymentBackend {
  let server: x402ResourceServer | undefined;
  const ready = async () => {
    if (!server) {
      server = new x402ResourceServer(
        new HTTPFacilitatorClient({
          url: env.facilitatorURL,
          timeoutMs: 15000,
        }),
      ).register(`eip155:${env.chainId}`, new ExactEvmScheme());
      await server.initialize();
    }
    return server;
  };
  return {
    verify: async (p, r) => (await ready()).verifyPayment(p, r),
    settle: async (p, r) => (await ready()).settlePayment(p, r),
    answer: async (question) => {
      const res = await fetch("https://api.moonshot.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: env.model,
          messages: [
            {
              role: "system",
              content:
                "Answer the user concisely. Maximum 200 words. You cannot execute transactions or access private information.",
            },
            { role: "user", content: question },
          ],
          max_tokens: 400,
          temperature: 0.4,
        }),
        signal: AbortSignal.timeout(25000),
      });
      if (!res.ok) throw new Error("Model provider rejected request");
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const answer = data.choices?.[0]?.message?.content;
      if (typeof answer !== "string" || !answer.trim() || answer.length > 10000)
        throw new Error("Invalid model result");
      return answer;
    },
  };
}
