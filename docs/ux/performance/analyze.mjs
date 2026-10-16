// Regenerate readable request waterfalls from the raw browser evidence.
import { readFile, writeFile } from 'node:fs/promises';
import { decodeFunctionData, multicall3Abi } from 'viem';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const abi=[...Object.values(require('../../../packages/sdk/src/abis.ts')).flat(),...multicall3Abi];
function functions(call) {
  try {
    const d=decodeFunctionData({abi,data:call.data});
    return d.functionName==='aggregate3' ? d.args[0].flatMap(c=>functions({data:c.callData})) : [d.functionName];
  } catch{return ['other'];}
}
let md='# Request waterfalls\n\n25 seconds from navigation. Times are milliseconds. Browser request start/completion includes connection setup, CORS and transfer. HTTP requests can contain multiple JSON-RPC calls and nested multicalls. `server GraphQL` is the first route read, measured on the server (including a cache lookup); its duration is embedded in the HTML. Cold uses a new browser context; warm reload retains HTTP cache and resets React Query.\n';
const summaries=[];
for(const label of ['before-production','before-local','after']) {
 const runs=JSON.parse(await readFile(new URL(`${label}.json`,import.meta.url),'utf8'));
 for(const run of runs) {
  const groups={};
  for(const r of run.requests) (groups[r.kind]??=[]).push(r);
  const summary={label,state:run.state,summaryMs:run.summaryMs,fullSummaryMs:run.fullSummaryMs,serverIndexerMs:run.serverIndexerMs,serverIndexerRequests:run.serverIndexerRequests,requests:Object.fromEntries(Object.entries(groups).map(([k,rows])=>[k,{count:rows.length,durations:rows.map(r=>r.durationMs)}]))};
  summaries.push(summary);
  md+=`\n## ${label} — ${run.state}\n\nSummary: ${Math.round(run.summaryMs)} ms; full terms sentence: ${Math.round(run.fullSummaryMs)} ms.\n\n| Request | Start | Duration | Work |\n|---|---:|---:|---|\n`;
  if(run.serverIndexerRequests)md+=`| server GraphQL | during HTML response | ${run.serverIndexerMs} | Bond(id) + Issuer(activeBond), 30-second server cache |\n`;
  for(const [i,r] of run.requests.entries()) {
   const work=r.kind==='RPC' ? (Array.isArray(r.payload)?r.payload:[r.payload]).flatMap(c=>c.method==='eth_call'?functions(c.params[0]):[c.method]).join(', ')
    : r.kind==='GraphQL' ? r.payload.query.match(/query (\w+)/)?.[1] || 'Full protocol: Issuer, Bond, DailyRevenue, PayerTotal, CovenantCheck' : new URL(r.url).search.slice(1).replaceAll(',','; ');
   md+=`| ${i+1}. ${r.kind} | ${r.startMs} | ${r.durationMs??'pending at cutoff'} | ${work} |\n`;
  }
 }
}
await writeFile(new URL('waterfalls.md',import.meta.url),md);
await writeFile(new URL('summary.json',import.meta.url),JSON.stringify(summaries,null,2)+'\n');
console.log(JSON.stringify(summaries,null,2));
