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
const OUT = path.join(HERE, 'output');
fs.mkdirSync(path.join(OUT, 'raw'), { recursive: true });
const d = JSON.parse(fs.readFileSync(path.join(HERE, '../../docs/deployments/10143.json')));
const LIVE = process.env.SLICE_VIDEO_APP ?? 'https://slice-flame.vercel.app';
const RPC = process.env.SLICE_VIDEO_RPC ?? 'https://testnet-rpc.monad.xyz';
const keyText = fs.readFileSync(path.join(os.homedir(), '.slice/pumplab-organic-0.key'), 'utf8').trim();
const account = privateKeyToAccount(keyText.startsWith('0x') ? keyText : `0x${keyText}`);
const publicClient = createPublicClient({ chain: monadTestnet, transport: http(RPC, { timeout: 10000, retryCount: 2 }) });
const wallet = createWalletClient({ account, chain: monadTestnet, transport: http(RPC, { timeout: 10000, retryCount: 0 }) });
const recording = process.argv.includes('--record');
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
      if (e.eventName === 'Transfer') transfers.push({ from: e.args.from, to: e.args.to, usdc: formatUnits(e.args.value,6), investorRepayment: e.args.to.toLowerCase() === d.issuers.pumplab.bond.toLowerCase() });
    } catch {}
  }
  fs.writeFileSync(path.join(OUT,`${name}-rpc.json`),json(r));
  const esc = x => String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  const body = `<!doctype html><meta charset="utf-8"><title>Monad testnet receipt</title><style>body{margin:0;background:#0a0a0a;color:#f5f5f5;font:22px system-ui;padding:58px 80px}small{color:#a0aaa5;font-size:17px}h1{font-size:38px;margin:15px 0 30px}h2{font-size:25px;margin-top:34px}code,pre{font:18px ui-monospace,monospace}dl{display:grid;grid-template-columns:180px 1fr;gap:15px}dt{color:#a0aaa5}dd{margin:0}strong{color:#34dfad}table{width:100%;border-collapse:collapse;font-size:17px}td,th{padding:16px 10px;text-align:left;border-bottom:1px solid #303733}td code{font-size:14px}.note{color:#a0aaa5;margin-top:30px;font-size:16px}</style><small>SLICE · PUBLIC CHAIN EVIDENCE / MONAD TESTNET · 10143</small><h1>${name==='native'?'A trade fee repays the bond':'Covenant report recorded onchain'}</h1><dl><dt>Status</dt><dd><strong>SUCCESS</strong></dd><dt>Transaction</dt><dd><code>${esc(hash)}</code></dd><dt>Block</dt><dd>${r.blockNumber}</dd><dt>From</dt><dd><code>${r.from}</code></dd><dt>To</dt><dd><code>${r.to}</code></dd></dl>${transfers.length?'<h2>USDC transfers in this transaction</h2><table><tr><th>From</th><th>To</th><th>USDC</th></tr>'+transfers.map(t=>`<tr><td><code>${t.from}</code></td><td><code>${t.to}</code>${t.investorRepayment?'<br><strong>SliceBond · investor repayment</strong>':''}</td><td>${t.investorRepayment?'<strong>':''}${t.usdc}${t.investorRepayment?'</strong>':''}</td></tr>`).join('')+'</table>':`<h2>Receipt evidence</h2><p>${r.logs.length} event log${r.logs.length===1?'':'s'} emitted by this transaction.</p><p><code>${r.logs.map(l=>l.address).join('<br>')}</code></p>`}<p class="note">Read-only evidence report, retrieved from Monad RPC. Transfers decoded from actual receipt logs.<br>Explorer reference: https://testnet.monadscan.com/tx/${hash}</p>`;
  const file = path.join(OUT,`${name}-receipt.html`);fs.writeFileSync(file,body);return 'file://'+file;
}
const bondAbi = parseAbi(['function deposit(uint256 amount)', 'function totalRevenueCollected() view returns (uint256)', 'function backingPerToken() view returns (uint256)']);
const launchAbi = parseAbi(['function buy(uint256 gross,uint256 minTokensOut,uint64 deadline) returns (uint256)', 'function quoteBuy(uint256 gross) view returns (uint256 out,uint256 fee)']);
const marketAbi = parseAbi([
  'function placeAndExecuteMarketBuy(uint96 size,uint256 minAmountOut,bool isMargin,bool isFillOrKill) payable returns (uint256)',
  'function getMarketParams() view returns (uint32,uint96,address,uint256,address,uint256,uint32,uint96,uint96,uint256,uint256)',
]);
let writes = 0;

function validate(to, data, value = 0n) {
  if (!recording) throw new Error('Read-only inspection: transaction disabled');
  if (value !== 0n) throw new Error('Native value transfer forbidden');
  const at = to.toLowerCase();
  let decoded;
  if (at === d.asset.toLowerCase()) {
    decoded = decodeFunctionData({ abi: erc20Abi, data });
    const [spender, amount] = decoded.args;
    const permitted = [d.issuers.pumplab.account, d.issuers.pumplab.kuruMarket, d.issuers.curvelab.bond].map(x => x.toLowerCase());
    if (decoded.functionName !== 'approve' || !permitted.includes(spender.toLowerCase()) || amount > 1_000_000n || amount <= 0n) throw new Error('Approval outside demo limits');
  } else if (at === d.issuers.curvelab.bond.toLowerCase()) {
    decoded = decodeFunctionData({ abi: bondAbi, data });
    if (decoded.functionName !== 'deposit' || decoded.args[0] !== 1_000_000n) throw new Error('Only a one-USDC demo deposit is allowed');
  } else if (at === d.issuers.pumplab.kuruMarket.toLowerCase()) {
    decoded = decodeFunctionData({ abi: marketAbi, data });
    if (decoded.functionName !== 'placeAndExecuteMarketBuy' || decoded.args[1] <= 0n || decoded.args[2] || decoded.args[3]) throw new Error('Unexpected market order');
    // getMarketParams confirms pricePrecision below; the app sends 0.1 USDC, capped by exact allowance.
    if (decoded.args[0] > 100_000n) throw new Error('Market size above capture cap');
  } else if (at === d.issuers.pumplab.source.toLowerCase()) {
    decoded = decodeFunctionData({ abi: launchAbi, data });
    if (decoded.functionName !== 'buy' || decoded.args[0] !== 1_000_000n || decoded.args[1] <= 0n) throw new Error('Only a one-USDC Native demo payment is allowed');
  } else throw new Error('Destination outside the demo allowlist');
  if (decoded.functionName !== 'approve' && evidence.some(e => e.functionName === decoded.functionName && e.to.toLowerCase() === at && e.status !== 'reverted')) {
    throw new Error('This action has already been recorded. Refusing to repeat a completed transaction.');
  }
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
  if (gas > 2_000_000n) throw new Error('Unexpected gas estimate');
  const hash = await wallet.sendTransaction({ to, data, value, gas });
  console.log(`TX ${decoded.functionName} ${hash}`);
  const entry = { chainId: 10143, from: account.address, to, functionName: decoded.functionName, args: decoded.args, hash, submittedAt: new Date().toISOString(), status: 'pending' };
  evidence.push(entry); saveEvidence();
  // Return the real hash immediately so the actual app displays its own pending and confirmed states.
  publicClient.waitForTransactionReceipt({ hash, pollingInterval: 200 }).then(r => {
    entry.status = r.status; entry.blockNumber = r.blockNumber; entry.logs = r.logs; saveEvidence();
  }).catch(e => console.error('Receipt lookup:', e.shortMessage ?? e.message));
  return hash;
}

if (await publicClient.getChainId() !== 10143) throw new Error('Monad testnet required');
const browser = await chromium.launch({ executablePath: process.env.SLICE_CHROME ?? path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'), headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 800 }, deviceScaleFactor: 1, colorScheme: 'dark', recordVideo: { dir: path.join(OUT, 'raw'), size: { width: 1600, height: 800 } } });
// Same real chain, alternate public read transport when the default RPC is unavailable.
// No response bodies or balances are fabricated or edited.
await context.route('https://testnet-rpc.monad.xyz/**', async route => {
  const response = await route.fetch({ url: RPC, timeout: 20000 });
  await route.fulfill({ response });
});
await context.exposeBinding('__sliceWalletRequest', async ({ frame }, { method, params = [] }) => {
  if (new URL(frame.url()).origin !== LIVE) throw new Error('Wallet restricted to Slice app');
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
    isSliceDemo: true,
    request: args => window.__sliceWalletRequest(args),
    on: (name, cb) => { const a = listeners.get(name) ?? []; a.push(cb); listeners.set(name, a); },
    removeListener: (name, cb) => listeners.set(name, (listeners.get(name) ?? []).filter(x => x !== cb)),
  };
});
const manifestPath = path.join(OUT, 'capture.json');
const shots = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath)) : {};
const saveShot = (id) => fs.writeFileSync(manifestPath, json({ ...(fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath,'utf8')) : {}), [id]: shots[id] }));
const pause = (page, seconds) => page.waitForTimeout(seconds * 1000);
async function focus(page, locator) {
  await locator.evaluate(el => window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 95, behavior: 'smooth' }));
  await pause(page, 0.8);
}
async function connect(page) {
  if (await page.getByRole('button', { name: 'Connect', exact: true }).isVisible()) {
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Browser wallet' }).click();
  }
  await page.getByRole('button', { name: 'Disconnect wallet' }).waitFor({ timeout: 20000 });
}
async function film(id, route, action) {
  if (only && only !== id) return;
  const page = await context.newPage();
  const createdAt = Date.now();
  let begin = 0;
  const marks = [];
  page.on('pageerror', e => console.log('PAGE_ERROR', id, e.message.slice(0,160)));
  try {
    await page.goto(/^(https?:|file:)/.test(route) ? route : LIVE + route, { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (route.startsWith('/')) {
      await page.getByRole('heading', { level: 1 }).waitFor({ timeout: 45000 });
      await pause(page, 2);
    }
    if (route.includes('/bonds/')) {
      await page.getByRole('heading', { name: 'Terms', exact: true }).waitFor({ timeout: 45000 });
      await page.locator('dt').filter({ hasText: /^(Repaid|Raised)$/ }).first().waitFor({ timeout: 45000 });
      await pause(page, 1);
    }
    if (id === '01-markets') {
      await page.getByRole('tab', { name: 'Trading', exact: true }).click();
      await page.getByText('PLAB-RC', { exact: false }).first().waitFor({ timeout: 30000 });
    }
    if (['05-kuru','06-deposit'].includes(id)) await connect(page);
    begin = (Date.now() - createdAt) / 1000;
    console.log('SCENE_START', id);
    const mark = label => marks.push({ label, at: (Date.now() - createdAt) / 1000 });
    await action(page, mark);
    const end = (Date.now() - createdAt) / 1000;
    await page.screenshot({ path: path.join(OUT, `${id}.png`) });
    const text = await page.locator('body').innerText();
    fs.writeFileSync(path.join(OUT, `${id}.txt`), text);
    await page.close();
    const video = await page.video().path();
    shots[id] = { video, begin, end, duration: end - begin, marks, capturedAt: new Date().toISOString() };
    saveShot(id);
    console.log('SCENE_DONE', id, Math.round(end-begin), 'seconds');
  } catch (e) {
    await page.screenshot({ path: path.join(OUT, `${id}-error.png`) }).catch(() => {});
    console.error('SCENE_FAILED', id, e.message);
    fs.writeFileSync(path.join(OUT, `${id}-error.txt`), await page.locator('body').innerText().catch(() => ''));
    const end = (Date.now() - createdAt) / 1000;
    await page.close();
    shots[id] = { video: await page.video().path(), begin, end, duration: end-begin, marks, failed: true, error: e.message, capturedAt: new Date().toISOString() };
    saveShot(id);
    throw e;
  }
}

try {
  if (!recording) {
    const page = await context.newPage();
    await page.goto(`${LIVE}/bonds/${d.issuers.pumplab.bond}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.getByRole('heading', { name: 'PumpLab', exact: true }).waitFor({ timeout: 45000 });
    await connect(page);
    await pause(page, 3);
    console.log((await page.locator('body').innerText()).slice(0,6500));
    await page.screenshot({ path: path.join(OUT, 'connected-preflight.png') });
    await page.close();
  } else {
    await film('01-markets', '/markets', async page => { await pause(page, 16); });
    await film('02-credit', `/accounts/${d.issuers.pumplab.account}`, async page => {
      await focus(page, page.getByRole('heading', { name: 'Credit history', exact: true })); await pause(page, 5);
      await focus(page, page.getByRole('heading', { name: 'Payers', exact: true })); await pause(page, 7);
      await focus(page, page.getByRole('heading', { name: 'Credit line', exact: true })); await pause(page, 10);
    });
    await film('03-staging', `/bonds/${d.issuers.pumplab.bond}`, async page => {
      await pause(page, 6);
      await focus(page, page.getByRole('heading', { name: 'Terms', exact: true })); await pause(page, 13);
    });
    await film('04-payment', `/bonds/${d.issuers.pumplab.bond}`, async (page, mark) => {
      const before = await publicClient.readContract({ address: d.issuers.pumplab.bond, abi: bondAbi, functionName: 'totalRevenueCollected' });
      const oldUI = await page.locator('dt').filter({ hasText: /^Repaid$/ }).evaluate(el => el.parentElement.innerText);
      await pause(page, 4); mark('before');
      const allowance = await publicClient.readContract({ address: d.asset, abi: erc20Abi, functionName: 'allowance', args: [account.address, d.issuers.pumplab.account] });
      if (allowance < 1_000_000n) {
        const { encodeFunctionData } = await import('viem');
        const hash = await send(d.asset, encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [d.issuers.pumplab.account, 1_000_000n] }));
        await publicClient.waitForTransactionReceipt({ hash });
      }
      const [quote] = await publicClient.readContract({ address: d.issuers.pumplab.source, abi: launchAbi, functionName: 'quoteBuy', args: [1_000_000n] });
      const block = await publicClient.getBlock();
      const { encodeFunctionData } = await import('viem');
      const hash = await send(d.issuers.pumplab.source, encodeFunctionData({ abi: launchAbi, functionName: 'buy', args: [1_000_000n, quote * 99n / 100n, block.timestamp + 600n] }));
      const receipt = await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 200 });
      if (receipt.status !== 'success') throw new Error('Native payment reverted');
      mark('confirmed');
      await page.waitForFunction(old => {
        const dt = [...document.querySelectorAll('dt')].find(el => el.textContent === 'Repaid');
        return dt && dt.parentElement.innerText !== old;
      }, oldUI, { timeout: 45000 });
      mark('ui-updated');
      await pause(page, 5);
      const after = await publicClient.readContract({ address: d.issuers.pumplab.bond, abi: bondAbi, functionName: 'totalRevenueCollected' });
      fs.writeFileSync(path.join(OUT, 'native-proof.json'), json({ before, after, hash, receipt }));
      mark('explorer-navigation');
      await page.goto(`https://testnet.monadscan.com/tx/${hash}`, { waitUntil: 'domcontentloaded' });
      await page.getByText('Success', { exact: true }).first().waitFor({ timeout: 45000 });
      mark('explorer-ready'); await pause(page, 12);
    });
    await film('05-kuru', `/bonds/${d.issuers.pumplab.bond}`, async (page, mark) => {
      const panel = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Trade on Kuru', exact: true }) });
      await focus(page, panel); await pause(page, 2);
      await panel.getByRole('textbox').fill('0.1');
      const approve = panel.getByRole('button', { name: 'Approve USDC', exact: true });
      if (await approve.isVisible()) {
        await approve.click();
        // The app immediately requotes after approval, replacing the transient receipt message.
        await panel.getByText('Minimum received', { exact: true }).waitFor({ timeout: 40000 });
      }
      await panel.getByText('Minimum received', { exact: true }).waitFor({ timeout: 30000 });
      mark('quote'); await pause(page, 5);
      await panel.getByRole('button', { name: 'Buy claims', exact: true }).click();
      await panel.getByRole('status').filter({ hasText: 'Buy: confirmed' }).waitFor({ timeout: 40000 });
      mark('confirmed'); await pause(page, 10);
    });
    await film('06-deposit', `/bonds/${d.issuers.curvelab.bond}`, async (page, mark) => {
      const panel = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Act', exact: true }) });
      await panel.getByRole('textbox').fill('1');
      const approve = panel.getByRole('button', { name: 'Approve USDC', exact: true });
      if (await approve.isVisible()) {
        await approve.click();
        await panel.getByRole('status').filter({ hasText: 'Approve: confirmed' }).waitFor({ timeout: 40000 });
      }
      mark('ready'); await pause(page, 3);
      await panel.getByRole('button', { name: 'Deposit', exact: true }).click();
      await panel.getByRole('status').filter({ hasText: 'Deposit: confirmed' }).waitFor({ timeout: 40000 });
      mark('confirmed'); await pause(page, 11);
    });
    await film('07-cre', `/bonds/${d.issuers.agent.bond}`, async (page, mark) => {
      await focus(page, page.getByRole('heading', { name: 'Monitoring', exact: true }));
      await pause(page, 18);
      const panel = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Monitoring', exact: true }) });
      const report = await panel.locator('a').first().getAttribute('href');
      fs.writeFileSync(path.join(OUT, 'cre-report.json'), json({ url: report, capturedAt: new Date().toISOString(), monitoring: await panel.innerText() }));
      mark('explorer-navigation');
      const hash = new URL(report).pathname.split('/').pop();
      await page.goto(await receiptDocument(hash, 'cre'), { waitUntil: 'domcontentloaded' });
      await page.getByText('SUCCESS', { exact: true }).waitFor();
      mark('explorer-ready');
      await pause(page, 9);
    });
    await film('08-close', '/markets', async page => { await pause(page, 12); });
    if (only === '04-receipt') {
      const proof = JSON.parse(fs.readFileSync(path.join(OUT, 'native-proof.json')));
      await film('04-receipt', await receiptDocument(proof.hash, 'native'), async page => {
        await page.getByText('SUCCESS', { exact: true }).waitFor();
        await pause(page, 15);
      });
    }
  }
} finally {
  await context.close();
  await browser.close();
}
