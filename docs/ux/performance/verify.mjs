// Read-only regression acceptance: real indexer/RPC except explicit delay/failure/holding scenarios.
import { chromium, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { decodeFunctionData, encodeFunctionData, encodeFunctionResult, multicall3Abi } from 'viem';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { bondrailVaultAbi: vaultAbi } = require('../../../packages/sdk/src/abis.ts');
const base = process.env.PERF_BASE || 'http://127.0.0.1:3215';
if (!['127.0.0.1','localhost'].includes(new URL(base).hostname)) throw new Error('Local preview only');
const bond = '0x66a9aafad577a6319645f4e2e2daaad42a987343';
const account = '0x067861e4bf4803a66db97cf74e252b6f4927fa54';
const browser = await chromium.launch({channel:'chrome',headless:true});
const results = [], errors = [];
async function setup() {
  const context = await browser.newContext({viewport:{width:375,height:812},reducedMotion:'reduce'});
  const page = await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  const requests=[];
  page.on('request',r=> { if(r.url().includes('/graphql') || r.url().includes('/api/registry') || r.url().includes('testnet-rpc.monad.xyz')) requests.push({url:r.url(),body:r.postDataJSON()}); });
  return {context,page,requests};
}
async function full(page) { await expect(page.locator('[data-testid="bond-sentence"]')).toBeVisible({timeout:30000}); }
function overrideHolding(call, response, holdings) {
  const abi=[...multicall3Abi,...vaultAbi];
  let decoded; try { decoded=decodeFunctionData({abi,data:call.data}); } catch { return response; }
  if(decoded.functionName==='holdings') return encodeFunctionResult({abi:vaultAbi,functionName:'holdings',result:holdings});
  if(decoded.functionName==='aggregate3') {
    const { decodeFunctionResult } = require('viem');
    const values=decodeFunctionResult({abi:multicall3Abi,functionName:'aggregate3',data:response});
    return encodeFunctionResult({abi:multicall3Abi,functionName:'aggregate3',result:values.map((v,i)=>({...v,returnData:overrideHolding({data:decoded.args[0][i].callData},v.returnData,holdings)}))});
  }
  return response;
}
// With all RPC and registry reads stalled, real indexed repayment values and evidence still render.
{
  const {context,page,requests}=await setup();
  let release; const gate=new Promise(resolve=>release=resolve);
  await page.route('**/api/registry?*', async r=>{await gate; await r.continue();});
  await page.route('https://testnet-rpc.monad.xyz/**', async r=>{await gate; await r.continue();});
  const start=Date.now();
  await page.goto(`${base}/bonds/${bond}`);
  await expect(page.locator('[data-testid="indexed-bond-summary"][data-ready="true"]')).toBeVisible({timeout:10000});
  const ms=Date.now()-start;
  await expect(page.locator('[data-testid="indexed-bond-summary"]')).toContainText('$0.0775 of $1.20');
  await expect(page.getByRole('heading',{name:'Revenue history',exact:true})).toBeVisible();
  await expect(page.locator('[data-testid="bond-sentence"]')).toHaveCount(0);
  await page.screenshot({path:'docs/ux/performance/indexed-before-rpc-375.png',fullPage:true});
  release(); await full(page);
  expect(await page.locator('[data-testid="bond-sentence"]').innerText()).toContain('until up to $2.40 has been repaid (currently up to $1.20, rising as more capital is released)');
  await expect(page.getByRole('link',{name:'View vault holdings',exact:true})).toHaveCount(0);
  await expect(page.locator('[data-testid="bond-page"] > section').first()).toContainText('Hold to earn; redeem after settlement');
  for(const r of requests.filter(r=>r.url.includes('/graphql'))) {
    expect(r.body.variables.address).toMatch(new RegExp(`${bond}|${account}`));
    expect(r.body.query).toContain('where:');
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  // Navigate while the shared snapshots are fresh: no full list query, metadata/registry re-fetch or credit re-fetch.
  await expect(page.getByText('Covers 1 of 1 bonds',{exact:true})).toBeVisible({timeout:15000});
  const before=requests.length;
  await page.getByRole('link',{name:'Read the full credit profile →'}).click();
  await expect(page.getByRole('heading',{name:'Credit profile',exact:true})).toBeVisible();
  await expect(page.locator(`a[href="/bonds/${bond}"]`).first()).toBeVisible();
  await page.locator(`a[href="/bonds/${bond}"]`).first().click(); await full(page);
  const nav=requests.slice(before);
  expect(nav.filter(r=>r.url.includes('/graphql')).every(r=>r.body.query.includes('AccountBonds'))).toBe(true);
  expect(nav.filter(r=>r.url.includes('/api/registry'))).toHaveLength(0);
  expect(nav.filter(r=>r.url.includes('testnet-rpc.monad.xyz'))).toHaveLength(0);
  results.push({test:'indexed summary survives delayed RPC/registry; cap/action/scope/cache/375px',ms,navigationRequests:nav});
  await page.unrouteAll({behavior:'ignoreErrors'}); await context.close();
}
// Positive, negative and unknown vault membership are checked at the actual rendered action.
for(const [name,holdings] of [['held',[bond]],['not-held',[]],['unknown',null]]) {
  const {context,page}=await setup();
  let holdingsSeen=0;
  await page.route('https://testnet-rpc.monad.xyz/**',async route=>{
    const request=route.request().postDataJSON(); const calls=Array.isArray(request)?request:[request];
    if(JSON.stringify(request).includes(encodeFunctionData({abi:vaultAbi,functionName:'holdings'}).slice(2))) holdingsSeen++;
    const response=await route.fetch(); const original=await response.json();
    const rows=Array.isArray(original)?original:[original];
    const replaced=rows.map(row=> {
      const call=calls.find(c=>c.id===row.id); if(call?.method!=='eth_call'||!row.result)return row;
      if(holdings===null && JSON.stringify(call).includes(encodeFunctionData({abi:vaultAbi,functionName:'holdings'}).slice(2))) return {...row,result:undefined,error:{code:-32000,message:'Holding read unavailable'}};
      return {...row,result:overrideHolding(call.params[0],row.result,holdings??[])};
    });
    await route.fulfill({json:Array.isArray(original)?replaced:replaced[0]});
  });
  await page.goto(`${base}/bonds/${bond}`); await full(page);
  if(holdings?.length) await expect(page.getByRole('link',{name:'View vault holdings',exact:true})).toBeVisible({timeout:15000});
  else { await expect.poll(()=>holdingsSeen).toBeGreaterThan(0); await page.waitForTimeout(1500); await expect(page.getByRole('link',{name:'View vault holdings',exact:true})).toHaveCount(0); }
  results.push({test:`vault ${name}`}); await page.unrouteAll({behavior:'ignoreErrors'}); await context.close();
}
// Complete RPC outage retains the indexed facts and evidence, with a retry for unavailable terms.
{
  const {context,page}=await setup();
  await page.route('https://testnet-rpc.monad.xyz/**',r=>{ const body=r.request().postDataJSON(); const replies=(Array.isArray(body)?body:[body]).map(x=>({jsonrpc:'2.0',id:x.id,error:{code:-32000,message:'RPC unavailable'}})); return r.fulfill({json:Array.isArray(body)?replies:replies[0]}); });
  await page.goto(`${base}/bonds/${bond}`);
  await expect(page.locator('[data-testid="indexed-bond-summary"][data-ready="true"]')).toBeVisible({timeout:15000});
  await expect(page.getByText('The bond terms could not be read.').first()).toBeVisible({timeout:20000});
  await expect(page.getByRole('heading',{name:'Revenue history',exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'View vault holdings',exact:true})).toHaveCount(0);
  results.push({test:'RPC outage retains indexed summary/evidence and exposes retry'});
  await page.unrouteAll({behavior:'ignoreErrors'}); await context.close();
}
// Failed account history must not gate known terms or turn unknown revenue into zero.
{
  const {context,page}=await setup();
  await page.route('**/graphql',route=>route.request().postDataJSON().query.includes('AccountEvidence')
    ? route.fulfill({json:{errors:[{message:'Account evidence unavailable'}]}}) : route.continue());
  await page.goto(`${base}/bonds/${bond}`); await full(page);
  await expect(page.getByText('Revenue history is unavailable.',{exact:false})).toBeVisible({timeout:20000});
  await expect(page.locator('[data-testid="bond-sentence"]')).toBeVisible();
  results.push({test:'failed account evidence retains full bond terms; unavailable history is explicit'});
  await page.unrouteAll({behavior:'ignoreErrors'}); await context.close();
}
// A fresh account route loads only this account. No whole-protocol list is needed.
{
  const {context,page,requests}=await setup();
  await page.goto(`${base}/accounts/${account}`);
  await expect(page.getByRole('heading',{name:'Revenue history',exact:true})).toBeVisible({timeout:20000});
  const graphql=requests.filter(r=>r.url.includes('/graphql'));
  expect(graphql).toHaveLength(2);
  expect(graphql.every(r=>r.body.variables.address===account && r.body.query.includes('where:'))).toBe(true);
  results.push({test:'fresh account uses two filtered queries',graphql:graphql.map(r=>r.body.query)});
  await page.unrouteAll({behavior:'ignoreErrors'}); await context.close();
}
expect(errors).toEqual([]);
await writeFile('docs/ux/performance/verification.json',JSON.stringify({results,errors},null,2)+'\n');
console.log(JSON.stringify({results,errors},null,2));
await browser.close();
