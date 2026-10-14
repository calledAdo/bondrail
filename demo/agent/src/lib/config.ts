import type { Address } from 'viem';
import { address } from '@bondrail/observer/protocol';
import type { DurableStore } from '@bondrail/observer/store';
export interface AgentConfig {
  revision: number;
  payTo: Address;
  updatedAt: string;
  audit: { revision: number; payTo: Address; at: string }[];
}
export interface AgentEnvironment {
  chainId: 10143 | 31337;
  asset: Address;
  publicURL: string;
  facilitatorURL: string;
  /** Any OpenAI-compatible chat-completions endpoint (Groq, OpenRouter, Moonshot/Kimi, ...). */
  modelBaseURL: string;
  model: string;
  apiKey?: string;
}
export function environment(env: NodeJS.ProcessEnv = process.env): AgentEnvironment {
  const chainId = Number(env.SLICE_CHAIN_ID ?? 10143);
  if (chainId !== 10143 && chainId !== 31337) throw new Error('Agent writes support testnet/local only');
  const asset =
    env.AGENT_USDC_ADDRESS ?? (chainId === 10143 ? '0x534b2f3A21130d7a60830c2Df862319e593943A3' : '');
  if (!address(asset)) throw new Error('Agent USDC address missing');
  const publicURL = env.AGENT_PUBLIC_URL;
  if (!publicURL) throw new Error('AGENT_PUBLIC_URL missing');
  const u = new URL(publicURL);
  if (
    u.username ||
    u.password ||
    (u.protocol !== 'https:' &&
      !(env.SLICE_ENV === 'local' && ['127.0.0.1', 'localhost'].includes(u.hostname)))
  )
    throw new Error('Invalid public URL');
  const facilitatorURL = env.X402_FACILITATOR_URL ?? 'https://x402-facilitator.molandak.org';
  if (new URL(facilitatorURL).protocol !== 'https:' && env.SLICE_ENV !== 'local')
    throw new Error('Facilitator requires HTTPS');
  return {
    chainId,
    asset,
    publicURL: u.origin,
    facilitatorURL,
    modelBaseURL: (env.MODEL_BASE_URL ?? 'https://api.groq.com/openai/v1').replace(/\/$/, ''),
    model: env.MODEL_ID ?? 'openai/gpt-oss-20b',
    apiKey: env.MODEL_API_KEY,
  };
}
const KEY = 'agent:config:v1';
export async function getConfig(store: DurableStore): Promise<AgentConfig> {
  const raw = await store.get(KEY);
  if (raw) return JSON.parse(raw) as AgentConfig;
  const payTo = process.env.AGENT_INITIAL_PAY_TO;
  if (!address(payTo) || /^0x0{40}$/i.test(payTo)) throw new Error('AGENT_INITIAL_PAY_TO missing');
  const updatedAt = new Date().toISOString(),
    config: AgentConfig = {
      revision: 0,
      payTo,
      updatedAt,
      audit: [{ revision: 0, payTo, at: updatedAt }],
    };
  if (await store.cas(KEY, null, JSON.stringify(config))) return config;
  const committed = await store.get(KEY);
  if (!committed) throw new Error('Config initialization busy');
  return JSON.parse(committed) as AgentConfig;
}
export async function updateConfig(
  store: DurableStore,
  revision: number,
  payTo: unknown,
): Promise<AgentConfig> {
  if (!Number.isSafeInteger(revision) || !address(payTo) || /^0x0{40}$/i.test(payTo))
    throw new Error('Invalid config');
  const raw = await store.get(KEY);
  if (!raw) throw new Error('Read config before updating');
  const old = JSON.parse(raw) as AgentConfig;
  if (old.revision !== revision) throw new Error('Revision conflict');
  if (old.audit.length >= 1000) throw new Error('Audit archive required before further updates');
  const updatedAt = new Date().toISOString(),
    next = {
      revision: revision + 1,
      payTo,
      updatedAt,
      audit: [...old.audit, { revision: revision + 1, payTo, at: updatedAt }],
    };
  if (!(await store.cas(KEY, raw, JSON.stringify(next)))) throw new Error('Revision conflict');
  return next;
}
