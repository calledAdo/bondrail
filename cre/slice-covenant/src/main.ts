import { Runner } from '@chainlink/cre-sdk';
import { z } from 'zod';
import { PARSER_VERSION } from '@slice/observer/protocol';
import { initWorkflow,type WorkflowConfig } from './workflow.js';
const address=z.string().regex(/^0x[0-9a-fA-F]{40}$/),decimal=z.string().regex(/^[1-9][0-9]*$/);
const configSchema=z.object({
  schedule:z.literal('*/30 * * * * *'),observerURL:z.string().url(),observerSigner:address,gasLimit:decimal,
  policy:z.object({id:z.string().regex(/^[a-z0-9-]{1,64}$/),chainId:z.literal(10143),chainSelector:z.literal('2183018362218727504'),covenant:address,bond:address,url:z.string().url(),method:z.literal('GET'),headers:z.record(z.string()),network:z.literal('eip155:10143'),asset:address,expectedPayTo:address,amount:decimal,maxTimeoutSeconds:z.number().int().min(1).max(300),parserVersion:z.literal(PARSER_VERSION),epochSeconds:z.literal(30),freshnessSeconds:z.literal(90)}).strict(),
}).strict();
async function main(){const runner=await Runner.newRunner<WorkflowConfig>({configParser:(raw)=>configSchema.parse(JSON.parse(new TextDecoder().decode(raw))) as WorkflowConfig});await runner.run(initWorkflow);}
main();
