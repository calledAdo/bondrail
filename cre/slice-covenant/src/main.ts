import { Runner } from '@chainlink/cre-sdk';
import { z } from 'zod';
import { PARSER_VERSION } from '@slice/observer/protocol';
import { initWorkflow, type WorkflowConfig } from './workflow.js';
// The CRE WASM runtime has no URL global, so URLs are checked with a pattern instead of z.url().
const url = z.string().regex(/^https?:\/\/[^\s/@]+\/\S*$/);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  decimal = z.string().regex(/^[1-9][0-9]*$/);
const configSchema = z
  .object({
    schedule: z.literal('*/30 * * * * *'),
    observerURL: url,
    simulationLoopbackObserver: z.boolean().optional(),
    observerSigner: address,
    gasLimit: decimal,
    policy: z
      .object({
        id: z.string().regex(/^[a-z0-9-]{1,64}$/),
        chainId: z.literal(10143),
        chainSelector: z.literal('2183018362218727504'),
        covenant: address,
        bond: address,
        manifestUrl: url,
        endpoints: z
          .array(z.object({ url: url, minAmount: decimal }).strict())
          .min(1)
          .max(8),
        method: z.literal('GET'),
        headers: z.record(z.string(), z.string()),
        network: z.literal('eip155:10143'),
        asset: address,
        expectedPayTo: address,
        maxTimeoutSeconds: z.number().int().min(1).max(300),
        parserVersion: z.literal(PARSER_VERSION),
        epochSeconds: z.literal(30),
        freshnessSeconds: z.literal(90),
      })
      .strict(),
  })
  .strict();
export async function main() {
  const runner = await Runner.newRunner<WorkflowConfig>({
    configParser: (raw) => configSchema.parse(JSON.parse(new TextDecoder().decode(raw))) as WorkflowConfig,
  });
  await runner.run(initWorkflow);
}
main();
