import { spawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { resolve,relative } from 'node:path';
import type { Hex } from 'viem';
export async function runCRE(projectDirectory:string,workflow:string,signal:AbortSignal):Promise<Hex>{
  const root=await realpath(projectDirectory),target=await realpath(resolve(root,workflow));
  if(relative(root,target).startsWith('..')||target===root)throw new Error('Workflow must be a child of the fixed CRE project');
  // No shell, caller-controlled command, arbitrary arguments or direct-report fallback.
  return await new Promise((resolveResult,reject)=>{
    const child=spawn('cre',['workflow','simulate',target,'--target','staging-settings','--broadcast','--non-interactive','--trigger-index','0'],{cwd:root,env:process.env,stdio:['ignore','pipe','pipe'],signal});
    let output='',size=0,failed=false;const timer=setTimeout(()=>{failed=true;child.kill('SIGKILL');},60000);
    const collect=(chunk:Buffer)=>{size+=chunk.length;if(size>262144){failed=true;child.kill('SIGKILL');return;}output+=chunk.toString();};
    child.stdout.on('data',collect);child.stderr.on('data',collect);
    child.on('error',error=>{clearTimeout(timer);reject(error);});
    child.on('exit',code=>{clearTimeout(timer);if(failed||code!==0){reject(new Error('CRE simulation failed or timed out; inspect supervised process privately'));return;}
      const tx=output.match(/SLICE_REPORT_TX=(0x[0-9a-fA-F]{64})/g)?.at(-1)?.split('=')[1];
      if(!tx){reject(new Error('CRE did not return a confirmed report transaction'));return;}resolveResult(tx as Hex);
    });
  });
}
