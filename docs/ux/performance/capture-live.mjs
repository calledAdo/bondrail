// Current local production UI with live indexer/RPC/registry data; no wallet or writes.
import { chromium, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { decodeFunctionData, multicall3Abi } from 'viem';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const abis=require('../../../packages/sdk/src/abis.ts');
const allAbi=[...Object.values(abis).flat(),...multicall3Abi];
const base=process.env.PERF_BASE || 'http://127.0.0.1:3215';
const deployment=JSON.parse(await readFile(new URL('../../deployments/10143.json',import.meta.url),'utf8'));
const browser=await chromium.launch({channel:'chrome',headless:true});
const results=[],errors=[];
function functions(call) {
  let decoded; try {decoded=decodeFunctionData({abi:allAbi,data:call.data});}catch{return ['unknown'];}
  return decoded.functionName==='aggregate3' ? decoded.args[0].flatMap(c=>functions({data:c.callData})) : [decoded.functionName];
}
for(const width of [375,1280]) {
  const context=await browser.newContext({viewport:{width,height:812},reducedMotion:'reduce'});
  const page=await context.newPage(); page.on('pageerror',e=>errors.push(e.message));
  for(const [name,issuer] of Object.entries(deployment.issuers)) {
    await page.goto(`${base}/bonds/${issuer.bond}`);
    await expect(page.locator('[data-testid="bond-sentence"]')).toBeVisible({timeout:30000});
    await expect(page.getByRole('heading',{name:'Source',exact:true})).toBeVisible();
    await expect(page.getByText('Reading lifecycle dates…')).toHaveCount(0,{timeout:15000});
    await expect(page.getByText('Reading registry…',{exact:true})).toHaveCount(0,{timeout:15000});
    // Wait for the real registry response to enrich the signed description.
    await expect(page.locator('[data-testid="bond-page"] h1')).toHaveText(issuer.name,{timeout:15000});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
    expect(overflow).toBe(false);
    const path=`docs/ux/performance/live-${name}-${width}.png`;
    await page.screenshot({path,fullPage:true});
    results.push({page:name,width,path,overflow,sentence:await page.locator('[data-testid="bond-sentence"]').innerText(),vaultLinks:await page.getByRole('link',{name:'View vault holdings',exact:true}).count()});
  }
  await context.close();
}
// List keeps one GraphQL request; only missing metadata/health come from RPC, all batched.
{
  const context=await browser.newContext({viewport:{width:375,height:812}});const page=await context.newPage();
  const requests=[];page.on('request',r=>{if(r.url().includes('/graphql')||r.url().includes('testnet-rpc.monad.xyz'))requests.push({url:r.url(),body:r.postDataJSON()});});
  await page.goto(`${base}/markets`);
  await expect(page.getByRole('heading',{name:'CurveLab',exact:true})).toBeVisible({timeout:20000});
  await page.getByRole('tab',{name:'Trading',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Oracle Agent',exact:true})).toBeVisible();
  await expect(page.getByText('Multiple',{exact:true})).toHaveCount(2,{timeout:20000});
  const gql=requests.filter(r=>r.url.includes('/graphql'));expect(gql).toHaveLength(1);
  const rpc=requests.filter(r=>r.url.includes('testnet-rpc.monad.xyz'));
  const methods=rpc.flatMap(r=>(Array.isArray(r.body)?r.body:[r.body]).flatMap(c=>c.method==='eth_call'?functions(c.params[0]):[c.method]));
  expect(methods.some(m=>['backingPerToken','pool','totalSupply','phase','effectiveCap','policyHash'].includes(m))).toBe(false);
  await page.screenshot({path:'docs/ux/performance/markets-375.png',fullPage:true});
  results.push({page:'markets',graphql:gql.length,rpcHttpRequests:rpc.length,methods});
  await context.close();
}
expect(errors).toEqual([]);
await writeFile('docs/ux/performance/live-captures.json',JSON.stringify({measuredAt:new Date().toISOString(),results,errors},null,2)+'\n');
console.log(JSON.stringify({measuredAt:new Date().toISOString(),results,errors},null,2));await browser.close();
