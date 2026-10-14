import { deploymentName, roleKeyPath } from '../../scripts/deployment-path.mjs';
const deploymentSuffix = deploymentName() === 'main' ? '' : `-${deploymentName()}`;
// Real browser capture and a narrowly scoped, Node-held testnet wallet.
// No key enters the browser. No simulated balances, responses or transaction receipts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createPublicClient, createWalletClient, decodeFunctionData, decodeEventLog, erc20Abi, http, parseAbi, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { monadTestnet } from 'viem/chains';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'output', 'technical');
const scenarioPath=path.join(OUT,'scenario.json');
const scenario=JSON.parse(fs.readFileSync(scenarioPath));
const mode=process.argv.find(x=>x.startsWith('--scene='))?.slice(8) ?? 'inspect';
const issuerMode=['issue','activate','inspect'].includes(mode);
const factoryAbi=JSON.parse(fs.readFileSync(path.join(HERE,'../../contracts/out/BondrailFactory.sol/BondrailFactory.json'))).abi;
fs.mkdirSync(path.join(OUT, 'raw'), { recursive: true });
const d = JSON.parse(fs.readFileSync(path.join(HERE, `../../docs/deployments/${process.env.BONDRAIL_CHAIN_ID ?? '10143'}${deploymentSuffix}.json`)));
const LIVE = process.env.BONDRAIL_VIDEO_APP ?? 'https://bondrail.vercel.app';
const RPC = process.env.BONDRAIL_VIDEO_RPC ?? 'https://testnet-rpc.monad.xyz';
const keyText = fs.readFileSync(roleKeyPath(issuerMode?scenario.issuerKey:scenario.payerKey), 'utf8').trim();
const account = privateKeyToAccount(keyText.startsWith('0x') ? keyText : `0x${keyText}`);
const publicClient = createPublicClient({ chain: monadTestnet, transport: http(RPC, { timeout: 10000, retryCount: 2 }) });
const wallet = createWalletClient({ account, chain: monadTestnet, transport: http(RPC, { timeout: 10000, retryCount: 0 }) });
const recording = ['issue','fund','activate','payment','kuru'].includes(mode);
const only = process.argv.find(x => x.startsWith('--only='))?.slice(7);
const json = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2);
const evidencePath = path.join(OUT, 'transactions.json');
const evidence = fs.existsSync(evidencePath) ? JSON.parse(fs.readFileSync(evidencePath)) : [];
const saveEvidence = () => fs.writeFileSync(evidencePath, json(evidence));
async function receiptDocument(hash, name) {
  const r = await publicClient.getTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error('Receipt must confirm success');
  const transfers = [];
  for (const log of r.logs) {
    if (log.address.toLowerCase() !== d.asset.toLowerCase()) continue;
    try {
      const e = decodeEventLog({ abi: erc20Abi, data: log.data, topics: log.topics });
      if (e.eventName === 'Transfer') transfers.push({ from: e.args.from, to: e.args.to, usdc: formatUnits(e.args.value,6), investorRepayment: e.args.to.toLowerCase() === scenario.bond.toLowerCase() });
    } catch {}
  }
  fs.writeFileSync(path.join(OUT,`${name}-rpc.json`),json(r));
  const esc = x => String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  const body = `<!doctype html><meta charset="utf-8"><title>Monad testnet receipt</title><style>body{margin:0;background:#0a0a0a;color:#f5f5f5;font:22px system-ui;padding:58px 80px}small{color:#a0aaa5;font-size:17px}h1{font-size:38px;margin:15px 0 30px}h2{font-size:25px;margin-top:34px}code,pre{font:18px ui-monospace,monospace}dl{display:grid;grid-template-columns:180px 1fr;gap:15px}dt{color:#a0aaa5}dd{margin:0}strong{color:#34dfad}table{width:100%;border-collapse:collapse;font-size:17px}td,th{padding:16px 10px;text-align:left;border-bottom:1px solid #303733}td code{font-size:14px}.note{color:#a0aaa5;margin-top:30px;font-size:16px}</style><small>BONDRAIL · PUBLIC CHAIN EVIDENCE / MONAD TESTNET · 10143</small><h1>${name==='native'?'A trade fee repays the bond':'Covenant report recorded onchain'}</h1><dl><dt>Status</dt><dd><strong>SUCCESS</strong></dd><dt>Transaction</dt><dd><code>${esc(hash)}</code></dd><dt>Block</dt><dd>${r.blockNumber}</dd><dt>From</dt><dd><code>${r.from}</code></dd><dt>To</dt><dd><code>${r.to}</code></dd></dl>${transfers.length?'<h2>USDC transfers in this transaction</h2><table><tr><th>From</th><th>To</th><th>USDC</th></tr>'+transfers.map(t=>`<tr><td><code>${t.from}</code></td><td><code>${t.to}</code>${t.investorRepayment?'<br><strong>Bond · investor repayment</strong>':''}</td><td>${t.investorRepayment?'<strong>':''}${t.usdc}${t.investorRepayment?'</strong>':''}</td></tr>`).join('')+'</table>':`<h2>Receipt evidence</h2><p>${r.logs.length} event log${r.logs.length===1?'':'s'} emitted by this transaction.</p><p><code>${r.logs.map(l=>l.address).join('<br>')}</code></p>`}<p class="note">Read-only evidence report, retrieved from Monad RPC. Transfers decoded from actual receipt logs.<br>Explorer reference: https://testnet.monadscan.com/tx/${hash}</p>`;
  const file = path.join(OUT,`${name}-receipt.html`);fs.writeFileSync(file,body);return 'file://'+file;
}
const bondAbi = parseAbi(['function deposit(uint256 amount)', 'function totalRevenueCollected() view returns (uint256)', 'function backingPerToken() view returns (uint256)']);
const launchAbi = parseAbi(['function buy(uint256 gross,uint256 minTokensOut,uint64 deadline) returns (uint256)', 'function quoteBuy(uint256 gross) view returns (uint256 out,uint256 fee)']);
const marketAbi = parseAbi([
  'function placeAndExecuteMarketBuy(uint96 size,uint256 minAmountOut,bool isMargin,bool isFillOrKill) payable returns (uint256)',
  'function getMarketParams() view returns (uint32,uint96,address,uint256,address,uint256,uint32,uint96,uint96,uint256,uint256)',
]);
let writes = 0;

function validate(to,data,value=0n) {
 if(!recording || value!==0n)throw Error('Write outside scene scope');
 const at=to.toLowerCase();let decoded;
 if(at===d.asset.toLowerCase()){
  decoded=decodeFunctionData({abi:erc20Abi,data});
  if(decoded.functionName!=='approve'||! [scenario.account,scenario.bond,d.issuers.pumplab.kuruMarket].filter(Boolean).some(x=>x.toLowerCase()===decoded.args[0].toLowerCase())||decoded.args[1]>2000000n||decoded.args[1]<=0n)throw Error('Approval outside cap');
 } else if(at===d.factory.toLowerCase()){
  decoded=decodeFunctionData({abi:factoryAbi,data});
  if(mode==='issue' && decoded.functionName==='createBond'){
   const [acct,t,c,name,symbol]=decoded.args;
   if(acct.toLowerCase()!==scenario.account.toLowerCase()||t.raiseAmount!==2000000n||t.repayCap!==2400000n||t.stake!==0n||t.revenueBps!==2500||t.firstReleaseBps!==5000||c.source.toLowerCase()!==scenario.source.toLowerCase()||symbol!=='LLAB-01')throw Error('Unexpected bond terms');
  }else if(!(mode==='activate'&&decoded.functionName==='activate'&&decoded.args[0].toLowerCase()===scenario.bond?.toLowerCase()))throw Error('Factory action outside scope');
 }else if(mode==='fund'&&at===scenario.bond?.toLowerCase()){
  decoded=decodeFunctionData({abi:bondAbi,data});if(decoded.functionName!=='deposit'||decoded.args[0]!==2000000n)throw Error('Expected two test USDC');
 }else if(mode==='payment'&&at===scenario.source.toLowerCase()){
  decoded=decodeFunctionData({abi:launchAbi,data});if(decoded.functionName!=='buy'||decoded.args[0]!==1000000n||decoded.args[1]<=0n)throw Error('Expected one test USDC payment');
 }else if(mode==='kuru'&&at===d.issuers.pumplab.kuruMarket.toLowerCase()){
  decoded=decodeFunctionData({abi:marketAbi,data});if(decoded.functionName!=='placeAndExecuteMarketBuy'||decoded.args[1]<=0n||decoded.args[2]||decoded.args[3])throw Error('Invalid market buy');
 }else throw Error('Destination outside scope');
 if(decoded.functionName!=='approve'&&evidence.some(e=>e.functionName===decoded.functionName&&e.to.toLowerCase()===at&&e.status!=='reverted'))throw Error('Already submitted: reconcile journal; do not repeat');
 return decoded;
}

async function send(to, data, value = 0n) {
  const decoded = validate(to, data, value);
  if (++writes > 6) throw new Error('Capture transaction count limit reached');
  if (await publicClient.getChainId() !== 10143) throw new Error('Wrong chain');
  if (decoded.functionName === 'placeAndExecuteMarketBuy') {
    const params = await publicClient.readContract({ address: to, abi: marketAbi, functionName: 'getMarketParams', gas: 200_000n });
    if (decoded.args[0] !== BigInt(params[0]) / 10n) throw new Error('Only a 0.1-USDC market order is permitted');
    if (params[4].toLowerCase() !== d.asset.toLowerCase() || Number(params[5]) !== 6) throw new Error('Unexpected quote asset');
  }
  await publicClient.call({ account: account.address, to, data, value });
  const estimated = await publicClient.estimateGas({ account: account.address, to, data, value });
  const gas = estimated * 12n / 10n;
  if (gas > 5_000_000n) throw new Error('Unexpected gas estimate');
  const hash = await wallet.sendTransaction({ to, data, value, gas });
  console.log(`TX ${decoded.functionName} ${hash}`);
  const entry = { chainId: 10143, from: account.address, to, functionName: decoded.functionName, args: decoded.args, hash, submittedAt: new Date().toISOString(), status: 'pending' };
  evidence.push(entry); saveEvidence();
  // Return the real hash immediately so the actual app displays its own pending and confirmed states.
  publicClient.waitForTransactionReceipt({ hash, pollingInterval: 200 }).then(r => {
    entry.status = r.status; entry.blockNumber = r.blockNumber; entry.logs = r.logs; saveEvidence();
    if(decoded.functionName==='createBond'&&r.status==='success'){for(const l of r.logs){try{const e=decodeEventLog({abi:factoryAbi,...l});if(e.eventName==='BondCreated'){scenario.bond=e.args.bond;fs.writeFileSync(scenarioPath,json(scenario));}}catch{}}}
  }).catch(e => console.error('Receipt lookup:', e.shortMessage ?? e.message));
  return hash;
}

if (await publicClient.getChainId() !== 10143) throw new Error('Monad testnet required');
const browser = await chromium.launch({ executablePath: process.env.BONDRAIL_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1, colorScheme: 'dark', recordVideo: { dir: path.join(OUT, 'raw'), size: { width: 1600, height: 900 } } });
// Same real chain, alternate public read transport when the default RPC is unavailable.
// No response bodies or balances are fabricated or edited.
await context.route('https://testnet-rpc.monad.xyz/**', async route => {
  const response = await route.fetch({ url: RPC, timeout: 20000 });
  await route.fulfill({ response });
});
await context.exposeBinding('__bondrailWalletRequest', async ({ frame }, { method, params = [] }) => {
  if (new URL(frame.url()).origin !== LIVE) throw new Error('Wallet restricted to Bondrail app');
  if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [account.address];
  if (method === 'eth_chainId') return '0x279f';
  if (method === 'net_version') return '10143';
  if (method === 'wallet_switchEthereumChain') {
    if (params[0]?.chainId !== '0x279f') throw new Error('Only Monad testnet is allowed');
    return null;
  }
  if (method === 'wallet_getCapabilities') return {};
  if (method === 'eth_sendTransaction') {
    const tx = params[0];
    if (tx.from?.toLowerCase() !== account.address.toLowerCase()) throw new Error('Wrong sender');
    if (tx.chainId && BigInt(tx.chainId) !== 10143n) throw new Error('Wrong chain');
    return send(tx.to, tx.data, BigInt(tx.value ?? 0));
  }
  if (!['eth_call', 'eth_estimateGas', 'eth_gasPrice', 'eth_maxPriorityFeePerGas', 'eth_getBlockByNumber', 'eth_getTransactionCount', 'eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_getBalance', 'eth_blockNumber', 'eth_feeHistory'].includes(method)) throw new Error(`Unsupported wallet request: ${method}`);
  return publicClient.request({ method, params });
});
await context.addInitScript(() => {
  const listeners = new Map();
  window.ethereum = {
    isBondrailDemo: true,
    request: args => window.__bondrailWalletRequest(args),
    on: (name, cb) => { const a = listeners.get(name) ?? []; a.push(cb); listeners.set(name, a); },
    removeListener: (name, cb) => listeners.set(name, (listeners.get(name) ?? []).filter(x => x !== cb)),
  };
});

await context.addInitScript(()=>{
 document.addEventListener('DOMContentLoaded',()=>{const el=document.createElement('div');el.id='demo-pointer';el.style.cssText='position:fixed;left:0;top:0;width:14px;height:14px;border:2px solid #9fe8ca;background:#202a2799;border-radius:50%;z-index:2147483647;pointer-events:none;transform:translate(-50%,-50%)';document.body.append(el);document.addEventListener('mousemove',e=>{el.style.left=e.clientX+'px';el.style.top=e.clientY+'px'});document.addEventListener('mousedown',()=>el.style.background='#9fe8ca');document.addEventListener('mouseup',()=>el.style.background='#202a2799')});
});
const page=await context.newPage(),start=Date.now(),marks=[];
const mark=label=>{marks.push({label,at:(Date.now()-start)/1000});console.log(label)};
const pause=s=>page.waitForTimeout(s*1000);
async function point(loc){await loc.scrollIntoViewIfNeeded();const b=await loc.boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:22});await pause(.3)}
async function click(loc){await point(loc);await loc.click()}
async function focus(loc){await loc.evaluate(el=>window.scrollTo({top:el.getBoundingClientRect().top+window.scrollY-100,behavior:'smooth'}));await pause(.8)}
async function connect(){if(await page.getByRole('button',{name:'Connect',exact:true}).isVisible()){await click(page.getByRole('button',{name:'Connect',exact:true}));await click(page.getByRole('menuitem',{name:'Browser wallet'}))}await page.getByRole('button',{name:'Disconnect wallet'}).waitFor({timeout:30000})}
async function go(route){await page.goto(LIVE+route,{waitUntil:'domcontentloaded',timeout:60000});await pause(4)}
async function step(name){const b=page.getByRole('button',{name:new RegExp(name)});if(await b.getAttribute('aria-expanded')!=='true')await click(b);await focus(b);return b.locator('..')}
try{
 if(mode==='opening'||mode==='close'){
  await go('/');await page.evaluate(()=>document.fonts.ready);mark('ready');await pause(7);
  await click(page.locator('main a[href="/markets"]').first());await page.getByRole('tab',{name:'Trading',exact:true}).waitFor();mark('markets');await pause(5);
 }else if(mode==='history'){
  await go('/accounts/'+scenario.account);await page.getByRole('heading',{name:'Credit profile',exact:true}).waitFor({timeout:60000});mark('ready');await pause(4);
  await focus(page.getByRole('heading',{name:'Credit history',exact:true}));await pause(7);await focus(page.getByRole('heading',{name:'Payers',exact:true}));await pause(5);
 }else if(['inspect','issue','activate'].includes(mode)){
  await go('/console');await connect();await page.getByRole('heading',{name:'Issue a revenue bond'}).waitFor({timeout:60000});
  await page.getByLabel('Account',{exact:true}).selectOption({label:scenario.name});await pause(3);mark('ready');
  if(mode==='issue'){
   const li=await step('Issue a bond');await pause(2);
   const fill=async(label,val)=>{const input=li.locator('label').filter({has:page.getByText(label,{exact:true})}).locator('input');await point(input);await input.fill(val);await pause(.3)};
   await fill('Claim name','LaunchLab Revenue Bond');await fill('Symbol','LLAB-01');await fill('Raise (USDC)','2');await fill('Revenue share (%)','25');await fill('Repayment cap (USDC)','2.4');await fill('Milestone revenue (USDC)','0.01');await fill('Fee floor while live (bps)','100');
   mark('terms-ready');while(Number((await publicClient.getBlock()).timestamp)<scenario.readyAt){console.log('Waiting for real minimum history');await pause(15)}await pause(3);await click(li.getByRole('button',{name:'Create bond',exact:true}));
   await page.getByRole('status').filter({hasText:'Create bond: confirmed'}).waitFor({timeout:60000});mark('confirmed');await focus(page.getByRole('status'));await pause(5);
  }else if(mode==='activate'){
   const li=await step('Raise and activate');await pause(3);await click(li.getByRole('button',{name:'Activate',exact:true}));await page.getByRole('status').filter({hasText:'Activate: confirmed'}).waitFor({timeout:60000});mark('confirmed');await pause(3);await go('/bonds/'+scenario.bond);await page.getByRole('heading',{name:'Terms',exact:true}).waitFor({timeout:60000});mark('bond-ready');await pause(5);await focus(page.getByRole('heading',{name:'Terms',exact:true}));await pause(6);
  }else{await step('Issue a bond');await pause(2)}
 }else{
  await go('/bonds/'+(mode==='kuru'?d.issuers.pumplab.bond:scenario.bond));await page.getByRole('heading',{name:'Terms',exact:true}).waitFor({timeout:60000});await connect();await pause(2);mark('ready');
  if(mode==='fund'){
   const panel=page.locator('section').filter({has:page.getByRole('heading',{name:'Act',exact:true})});await focus(panel);await panel.getByRole('textbox').fill('2');await pause(2);
   const approve=panel.getByRole('button',{name:'Approve USDC',exact:true});if(await approve.isVisible()){await click(approve);await panel.getByRole('status').filter({hasText:'Approve: confirmed'}).waitFor({timeout:60000})}
   mark('approved');await pause(2);await click(panel.getByRole('button',{name:'Deposit',exact:true}));await panel.getByRole('status').filter({hasText:'Deposit: confirmed'}).waitFor({timeout:60000});mark('confirmed');await pause(7);
  }else if(mode==='kuru'){
   const panel=page.locator('section').filter({has:page.getByRole('heading',{name:'Trade on Kuru',exact:true})});await focus(panel);await panel.getByRole('textbox').fill('0.1');
   const approve=panel.getByRole('button',{name:'Approve USDC',exact:true});if(await approve.isVisible()){await click(approve);await panel.getByText('Minimum received',{exact:true}).waitFor({timeout:60000})}
   await panel.getByText('Minimum received',{exact:true}).waitFor({timeout:60000});mark('quote');await pause(4);await click(panel.getByRole('button',{name:'Buy claims',exact:true}));await panel.getByRole('status').filter({hasText:'Buy: confirmed'}).waitFor({timeout:60000});mark('confirmed');await pause(6);
  }else if(mode==='payment'){
   const before=await publicClient.readContract({address:scenario.bond,abi:bondAbi,functionName:'totalRevenueCollected'});await pause(5);mark('before');
   const {encodeFunctionData}=await import('viem');const allowance=await publicClient.readContract({address:d.asset,abi:erc20Abi,functionName:'allowance',args:[account.address,scenario.account]});
   if(allowance<1000000n){const hash=await send(d.asset,encodeFunctionData({abi:erc20Abi,functionName:'approve',args:[scenario.account,1000000n]}));await publicClient.waitForTransactionReceipt({hash})}
   const [quote]=await publicClient.readContract({address:scenario.source,abi:launchAbi,functionName:'quoteBuy',args:[1000000n]});const block=await publicClient.getBlock();
   const hash=await send(scenario.source,encodeFunctionData({abi:launchAbi,functionName:'buy',args:[1000000n,quote*99n/100n,block.timestamp+600n]}));await publicClient.waitForTransactionReceipt({hash});mark('confirmed');
   await pause(12);const after=await publicClient.readContract({address:scenario.bond,abi:bondAbi,functionName:'totalRevenueCollected'});fs.writeFileSync(path.join(OUT,'payment-proof.json'),json({before,after,hash}));mark('updated');await pause(5);
   await page.goto(await receiptDocument(hash,'native'));mark('receipt');await pause(10);
  }
 }
 await page.screenshot({path:path.join(OUT,mode+'.png')});fs.writeFileSync(path.join(OUT,mode+'.txt'),await page.locator('body').innerText());mark('end');
}catch(e){console.error(e.message);await page.screenshot({path:path.join(OUT,mode+'-error.png')});fs.writeFileSync(path.join(OUT,mode+'-error.txt'),await page.locator('body').innerText());mark('failed');process.exitCode=1}
finally{await context.unrouteAll({behavior:"ignoreErrors"});await page.close();const video=await page.video().path();const captureFile=path.join(OUT,'capture.json');const captures=fs.existsSync(captureFile)?JSON.parse(fs.readFileSync(captureFile)):{};captures[mode]={video,marks,capturedAt:new Date().toISOString()};fs.writeFileSync(captureFile,json(captures));await context.close();await browser.close()}
