// DEMO: the Oracle Agent's paid Q&A, built on @bondrail/sdk/x402. The SDK does the x402 work (offer,
// verification, journal, settlement into the SliceAccount); this file only says what is sold and how.
import {
  exactUsdcRequirements,
  handlePaidRequest as sliceHandlePaidRequest,
  httpFacilitator,
  type Facilitator,
  type PaymentRecord,
} from '@bondrail/sdk/x402';
import type { DurableStore } from '@bondrail/observer/store';
import type { AgentConfig, AgentEnvironment } from './config';

export type { PaymentRecord };
export interface PaymentBackend extends Facilitator {
  answer(question: string): Promise<string>;
}

/** $0.01 test USDC per question, paid to the agent's current payTo (its SliceAccount). */
export function requirements(env: AgentEnvironment, config: AgentConfig) {
  return exactUsdcRequirements({ chainId: env.chainId, asset: env.asset, amount: '10000', payTo: config.payTo });
}

export function resourceURL(env: AgentEnvironment, question: string) {
  const u = new URL('/api/oracle', env.publicURL);
  u.searchParams.set('question', question);
  return u.toString();
}

export function handlePaidRequest(
  question: string,
  header: string | null,
  env: AgentEnvironment,
  config: AgentConfig,
  store: DurableStore,
  backend: PaymentBackend,
): Promise<Response> {
  return sliceHandlePaidRequest({
    header,
    resource: resourceURL(env, question),
    description: 'Oracle Agent answer',
    requirements: requirements(env, config),
    store,
    facilitator: backend,
    work: () => backend.answer(question),
    available: !!env.apiKey,
    resultField: 'answer',
  });
}

export function realBackend(env: AgentEnvironment): PaymentBackend {
  const facilitator = httpFacilitator(env.facilitatorURL, env.chainId);
  return {
    ...facilitator,
    answer: async (question) => {
      const res = await fetch(`${env.modelBaseURL}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: env.model,
          messages: [
            {
              role: 'system',
              content:
                'Answer the user concisely. Maximum 200 words. You cannot execute transactions or access private information.',
            },
            { role: 'user', content: question },
          ],
          max_tokens: 400,
          temperature: 0.4,
        }),
        signal: AbortSignal.timeout(25000),
      });
      if (!res.ok) throw new Error('Model provider rejected request');
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const answer = data.choices?.[0]?.message?.content;
      if (typeof answer !== 'string' || !answer.trim() || answer.length > 10000)
        throw new Error('Invalid model result');
      return answer;
    },
  };
}
