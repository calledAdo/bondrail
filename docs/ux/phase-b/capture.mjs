// Local-only browser acceptance. Live pages read public testnet data; fixtures mock every RPC read.
// Run: node --import tsx docs/ux/phase-b/capture.mjs (preview setup in README.md).
import { chromium, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { decodeFunctionData, encodeFunctionResult, erc20Abi, multicall3Abi, parseAbi, zeroAddress } from 'viem';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const abis = require('../../../packages/sdk/src/abis.ts');
const { bondFixtures, fixtureAccount, marketFixture, FIXTURE_NOW } = require('../../../apps/web/src/lib/bond-fixtures.ts');
const { bondSummary } = require('../../../apps/web/src/lib/bond-decision.ts');
const out = fileURLToPath(new URL('.', import.meta.url));
const deployment = JSON.parse(await readFile(new URL('../../deployments/10143.json', import.meta.url), 'utf8'));
const base = process.env.PHASE_B_BASE_URL || 'http://localhost:3212';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Use a local preview');
const registryUrl = `https://bondrail.vercel.app/api/registry?accounts=${Object.values(deployment.issuers).map(x => x.account).join(',')}&bonds=${Object.values(deployment.issuers).map(x => x.bond).join(',')}`;
const registry = await fetch(registryUrl).then(r => { if (!r.ok) throw new Error(`Registry ${r.status}`); return r.json(); });
await writeFile(`${out}registry-snapshot.json`, JSON.stringify(registry, null, 2) + '\n');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [], errors = [], unexpected = [];
const priceAbi = parseAbi(['function bestBidAsk() view returns (uint256,uint256)', 'function getMarketParams() view returns (uint32,uint96,address,uint256,address,uint256,uint32,uint96,uint96,uint256,uint256)']);
const allAbi = [...Object.values(abis).flat(), ...erc20Abi, ...multicall3Abi, ...priceAbi];
const zero = param => param.type.endsWith('[]') ? [] : param.type === 'tuple' ? Object.fromEntries(param.components.map(c => [c.name, zero(c)])) : param.type === 'address' ? zeroAddress : param.type === 'bool' ? false : param.type === 'string' ? '' : param.type.startsWith('bytes') ? `0x${'00'.repeat(Number(param.type.slice(5)) || 0)}` : 0n;
function callResult(data, b, options = {}) {
  const { functionName: fn, args } = decodeFunctionData({ abi: allAbi, data });
  const method = allAbi.find(x => x.type === 'function' && x.name === fn);
  let outputs = method.outputs.map(zero);
  if (fn === 'aggregate3') outputs = [args[0].map(call => ({ success: true, returnData: callResult(call.callData, b, options) }))];
  else if (fn === 'onchainProfile') {
    if (options.creditError) throw new Error('Fixture registry unavailable');
    outputs[0] = { ...outputs[0], asset: b.asset.address, issuer: fixtureAccount.issuer, project: fixtureAccount.project, bondsCreated: 3n, complete: false, repayment: { ...outputs[0].repayment, bondsIssued: 2n } };
  } else if (fn === 'attestedProfile') {
    outputs = [{ ...outputs[0], account: b.account, creditLine: 100000000n, issuedAt: BigInt(FIXTURE_NOW - 86400), expiresAt: 2000000000n }, fixtureAccount.issuer, true];
  } else if (fn === 'attester' || fn === 'issuer') outputs = [fixtureAccount.issuer];
  else if (fn === 'decimals') outputs = [6];
  else if (fn === 'symbol') outputs = ['USDC'];
  else if (fn === 'balanceOf') outputs = [1000000000n];
  else if (fn === 'allowance') outputs = [1000000000n];
  else if (fn === 'pool') outputs = [BigInt(b.pool * 1e6)];
  else if (fn === 'totalSupply') outputs = [BigInt(b.supply * 1e6)];
  else if (fn === 'settleAfter') outputs = [BigInt(b.settleAfter || 0)];
  else if (fn === 'covenant') outputs = [deployment.covenant];
  else if (fn === 'darkFor') outputs = [0n];
  else if (fn === 'bestBidAsk') outputs = options.emptyAsk ? [0n, 0n] : [900000000000000000n, 1000000000000000000n];
  else if (fn === 'getMarketParams') outputs = [1000000,1000000n,b.address,6n,b.asset.address,6n,1,1n,1000000000n,30n,0n];
  else { unexpected.push(fn); throw new Error('Unmocked fixture read: ' + fn); }
  return encodeFunctionResult({ abi: [method], functionName: fn, result: outputs.length === 1 ? outputs[0] : outputs });
}
async function open(viewport, phase, options = {}) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce', hasTouch: viewport.width < 600 });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(investor => {
    window.__writes = 0; window.__cls = 0;
    new PerformanceObserver(list => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__cls += entry.value; }).observe({ type: 'layout-shift', buffered: true });
    window.ethereum = { isMetaMask: true, on() {}, removeListener() {}, async request({ method }) {
      if (['eth_accounts','eth_requestAccounts'].includes(method)) return [investor];
      if (method === 'eth_chainId') return '0x279f';
      if (method === 'net_version') return '10143';
      if (['wallet_requestPermissions','wallet_getPermissions'].includes(method)) return [{parentCapability:'eth_accounts'}];
      window.__writes++; throw new Error('Read-only review wallet: ' + method);
    }};
  }, deployment.roles.investor);
  await page.route('**/api/registry?*', route => route.fulfill({ json: registry }));
  await page.route('https://testnet-rpc.monad.xyz/**', async route => {
    const body = route.request().postDataJSON();
    const requests = Array.isArray(body) ? body : [body];
    if (requests.some(r => !['eth_call','eth_blockNumber','eth_getBalance','eth_chainId'].includes(r.method))) throw new Error('Non-read RPC blocked');
    if (!phase) return route.continue();
    const b = phase === 'Active-market' ? marketFixture : bondFixtures[phase];
    const reply = requests.map(r => {
      try { return { jsonrpc:'2.0',id:r.id,result:r.method === 'eth_call' ? callResult(r.params[0].data,b,options) : r.method === 'eth_chainId' ? '0x279f' : '0x10000000' }; }
      catch (e) { return { jsonrpc:'2.0',id:r.id,error:{code:-32000,message:e.message} }; }
    });
    await route.fulfill({ json:Array.isArray(body) ? reply : reply[0] });
  });
  return { context, page };
}
async function assertLayout(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator('[data-testid="bond-page"] h2:visible').allTextContents()).toEqual(['How this bond works', 'What you get', 'Evidence', 'Revenue history', 'Payers', 'Source', 'Credit profile', 'How you could lose money', 'What you can do now']);
  for (const name of ['Maintenance (anyone can run)','Full terms & technical details']) await expect(page.locator('details').filter({ has: page.locator('summary').filter({hasText:name}) }).first()).not.toHaveAttribute('open','');
  const primary = page.locator('[data-testid="bond-page"] > section').first().locator('button.bg-primary');
  expect(await primary.count()).toBeLessThanOrEqual(1);
  if (await primary.count()) { const box = await primary.boundingBox(); expect(box.y + box.height).toBeLessThan(page.viewportSize().height); }
  expect(await page.evaluate(() => window.__writes)).toBe(0);
}
async function connect(page) {
  await page.getByRole('button',{name:'Connect',exact:true}).click();
  await page.getByRole('menuitem',{name:'Browser wallet'}).click();
  await expect(page.getByRole('button',{name:'Disconnect wallet'})).toBeVisible();
}
async function contrast(page) {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const rgb = color => { ctx.clearRect(0,0,1,1); ctx.fillStyle = color; ctx.fillRect(0,0,1,1); return [...ctx.getImageData(0,0,1,1).data]; };
    const luminance = c => c.slice(0,3).map(v => v/255).map(v => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4).reduce((sum,v,i) => sum+v*[.2126,.7152,.0722][i],0);
    const backdrop = el => { if (!el) return [255,255,255,255]; const c = rgb(getComputedStyle(el).backgroundColor); const under = c[3] < 255 ? backdrop(el.parentElement) : c; return c.slice(0,3).map((v,i)=>v*c[3]/255+under[i]*(1-c[3]/255)); };
    const failures = [];
    let lowest = 100;
    for (const el of document.querySelectorAll('[data-testid="bond-page"] *')) {
      if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) || el.closest('[hidden]') || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) || el.matches(':disabled')) continue;
      const style = getComputedStyle(el), fg = rgb(style.color), bg = backdrop(el);
      const composed = fg.slice(0,3).map((v,i)=>v*fg[3]/255+bg[i]*(1-fg[3]/255));
      const a = luminance(composed), b = luminance(bg), ratio = (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
      const large = parseFloat(style.fontSize) >= 24 || (parseFloat(style.fontSize) >= 18.66 && Number(style.fontWeight) >= 700);
      lowest = Math.min(lowest,ratio);
      if (ratio < (large ? 3 : 4.5)) failures.push({text:el.textContent.slice(0,80),ratio,color:style.color});
    }
    return { lowest, failures };
  });
}
async function screenshot(page, name) {
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  await page.mouse.move(0,0); await page.evaluate(() => { document.activeElement?.blur(); scrollTo(0,0); });
  await page.screenshot({path:`${out}${name}.png`,fullPage:true});
}
try {
  for (const [size, viewport] of [['375',{width:375,height:844}],['1280',{width:1280,height:960}]]) {
    for (const [key, issuer] of Object.entries(process.env.PHASE_B_FIXTURES_ONLY ? {} : deployment.issuers)) {
      const {context,page} = await open(viewport);
      await page.goto(`${base}/bonds/${issuer.bond}`);
      await expect(page.getByRole('heading',{name:issuer.name,exact:true})).toBeVisible({timeout:90000});
      await expect(page.getByText('Reading registry…',{exact:true})).toHaveCount(0,{timeout:60000});
      await assertLayout(page);
      await screenshot(page,`live-${key}-${size}`);
      results.push({check:`Live ${issuer.name} ${size}: section order, disclosure, primary above fold, no overflow`,cls:await page.evaluate(()=>window.__cls)});
      console.log(results.at(-1)?.check);
      await context.close();
    }
    for (const phase of [...Object.keys(bondFixtures),'Active-market']) {
      const {context,page} = await open(viewport,phase);
      await page.goto(`${base}/review-phase-b/${phase}`);
      await expect(page.getByRole('heading',{name:'Fixture Studio',exact:true})).toBeVisible();
      await expect(page.getByText('Covers 2 of 3 bonds',{exact:true})).toBeVisible();
      const b = phase === 'Active-market' ? marketFixture : bondFixtures[phase];
      await expect(page.getByTestId('bond-sentence')).toHaveText(bondSummary(b), { useInnerText: true });
      await expect(page.locator('[aria-current="step"]')).toHaveCount(1);
      await assertLayout(page);
      await screenshot(page,`fixture-${phase.toLowerCase()}-${size}`);
      if (phase === 'Funding') {
        const payers = page.locator('section').filter({has:page.getByRole('heading',{name:'Payers',exact:true})}).last();
        await expect(payers.locator('tbody tr')).toHaveCount(5);
        await page.getByRole('button',{name:'Show all 8 payers'}).click();
        await expect(payers.locator('tbody tr')).toHaveCount(8);
        await page.getByRole('button',{name:'Show top 5'}).click();
        const term = page.getByRole('button',{name:'claim',exact:true}).first();
        await term.focus(); await expect(page.getByRole('dialog',{name:'claims definition'})).toBeVisible();
        await expect(term).toHaveAttribute('aria-describedby',/.+/);
        await page.keyboard.press('Tab'); await expect(page.getByRole('link',{name:'Learn more about claims'})).toBeFocused();
        await page.keyboard.press('Escape'); await expect(page.getByRole('dialog',{name:'claims definition'})).toHaveCount(0);
        if (size === '375') await term.tap(); else await term.click();
        await expect(page.getByRole('dialog',{name:'claims definition'})).toBeVisible();
        await page.getByRole('button',{name:'Close',exact:true}).click(); await expect(term).toBeFocused();
        const darkContrast = await contrast(page); expect(darkContrast.failures).toEqual([]);
        await page.getByRole('button',{name:'Switch to light theme'}).click();
        const lightContrast = await contrast(page); expect(lightContrast.failures).toEqual([]);
        results.push({ check: `${size}: actual text contrast passes in both themes`, darkContrast, lightContrast });
        await screenshot(page,`fixture-funding-light-${size}`);
        await page.getByRole('button',{name:'Switch to dark theme'}).click();
        await page.getByLabel('Amount in USD').fill('20');
        await expect(page.getByText('$25.00',{exact:true})).toBeVisible();
        await page.getByLabel('Amount in USD').fill('0');
        await expect(page.getByText('Enter a positive amount, such as 10.')).toBeVisible();
      }
      if (phase === 'Active') {
        await connect(page);
        await page.getByRole('button',{name:'Redeem early',exact:true}).first().click();
        await page.getByLabel('Amount (claims)',{exact:true}).fill('1');
        const redeem = page.locator('#bond-actions').getByRole('button',{name:'Redeem early',exact:true}).last();
        await expect(redeem).toBeEnabled(); await redeem.click();
        const dialog = page.getByRole('dialog',{name:'Confirm early redemption'});
        await expect(dialog).toContainText('0.2 USDC');
        await expect(dialog.getByRole('button',{name:'Burn claims and redeem'})).toBeDisabled();
        await dialog.getByRole('checkbox').check();
        await expect(dialog.getByRole('button',{name:'Burn claims and redeem'})).toBeEnabled();
        await page.screenshot({path:`${out}early-confirmation-${size}.png`});
        await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible(); await expect(redeem).toBeFocused();
        await page.getByLabel('Amount (claims)',{exact:true}).fill('1000'); await expect(redeem).toBeDisabled();
        await page.getByLabel('Amount (claims)',{exact:true}).fill('0.0000001'); await expect(redeem).toBeDisabled();
      }
      if (phase === 'Closing') {
        await expect(page.getByRole('button',{name:/^(Redeem|Redeem early|Buy claims|Sell claims)$/})).toHaveCount(0);
        await expect(page.getByText(/Settling — redemption opens/).first()).toBeVisible();
      }
      if (phase === 'Funding-paused') await expect(page.getByRole('button',{name:'Deposit',exact:true})).toHaveCount(0);
      if (phase === 'Active-market') {
        await expect(page.getByText('Buy at the current Kuru asking price:',{exact:false})).toBeVisible();
        await page.getByRole('button',{name:'Sell claims',exact:true}).first().click();
        await expect(page.getByLabel(/Sell \(claims\)/)).toBeVisible();
      }
      expect(await page.evaluate(()=>window.__writes)).toBe(0);
      results.push({check:`Fixture ${phase} ${size}: sentence, timeline, action, and applicable interaction checks pass`});
      console.log(results.at(-1)?.check);
      await context.close();
    }
  }
  const {context,page} = await open({width:375,height:844},'Active-market',{emptyAsk:true,creditError:true});
  await page.goto(`${base}/review-phase-b/Active-market`);
  await expect(page.getByText('No usable asking price.',{exact:false})).toBeVisible();
  await expect(page.getByText('Credit registry could not be read.',{exact:false})).toBeVisible({timeout:60000});
  await expect(page.getByRole('heading',{name:'How you could lose money',exact:true})).toBeVisible();
  await screenshot(page,'empty-market-credit-error-375');
  results.push({check:'Empty ask and failed credit registry stay local to their sections; risks remain readable'});
  console.log(results.at(-1)?.check);
      await context.close();
  const loading = await open({width:375,height:844});
  let pending, fail = false;
  await loading.page.route('**/v1/graphql', route => { if (fail) return route.fulfill({json:{errors:[{message:'Fixture indexer unavailable'}]}}); pending = route; });
  await loading.page.goto(`${base}/bonds/${deployment.issuers.agent.bond}`);
  await expect(loading.page.getByRole('status',{name:'Loading Bond summary'})).toBeVisible();
  await screenshot(loading.page,'loading-sections-375');
  fail = true; await pending.fulfill({json:{errors:[{message:'Fixture indexer unavailable'}]}});
  await expect(loading.page.getByRole('button',{name:'Retry data'})).toHaveCount(6,{timeout:30000});
  await screenshot(loading.page,'indexer-error-sections-375');
  results.push({check:'Six reserved section skeletons transition to independent error/retry cards on indexer failure'});
  await loading.context.close();
  expect(errors).toEqual([]); expect(unexpected).toEqual([]);
  await writeFile(`${out}browser-results.json`,JSON.stringify({capturedAt:new Date().toISOString(),base,registryUrl,liveData:'Public RPC/indexer reads; signed profiles saved in registry-snapshot.json',fixtures:'Synthetic model and mocked read-only RPC; never transactions',errors,unexpected,results},null,2)+'\n');
  console.log(`PASS: ${results.length} browser groups`);
} finally { await browser.close(); }
