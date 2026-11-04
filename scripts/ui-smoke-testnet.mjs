import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import {
  createWalletClient,
  decodeFunctionData,
  erc20Abi,
  formatUnits,
  http,
  keccak256,
  parseAbi,
} from 'viem';
import { monadTestnet } from 'viem/chains';
import {
  ADDRESS,
  RPC,
  client,
  deployment,
  gasCheck,
  ledger,
  lock,
  reserve,
  signer,
  update,
} from '../demo/video/remotion/scripts/wallet.mjs';
import { bondrailBondAbi as bondAbi } from '../packages/sdk/src/abis.ts';

const root = path.resolve(import.meta.dirname, '..');
const bond = deployment.issuers.pumplab.bond;
const asset = deployment.asset;
const kuruMarket = deployment.issuers.pumplab.kuruMarket;
const kuruVault = deployment.issuers.pumplab.kuruVault;
const kuruRouter = '0x7EFbE105Ca7415dE98F96622173458ac1c054630';
const scenario = process.argv.includes('--scenario=kuru') ? 'kuru' : 'deposit';
const amount = scenario === 'kuru' ? 100_000n : 1_000_000n;
const outDir = path.join(root, 'docs/ux/smoke-2026-11');
const logPath = path.join(outDir, 'run.json');
const verifyOnly = process.argv.includes('--verify-completed');
const previousRun = fs.existsSync(logPath) ? JSON.parse(fs.readFileSync(logPath, 'utf8')) : null;
const bondReadAbi = parseAbi([
  'function terms() view returns ((uint256 raiseAmount,uint256 repayCap,uint256 stake,uint256 minRevenue,uint64 fundingDeadline,uint64 maturity,uint64 secondReleaseNotBefore,uint64 secondReleaseDeadline,uint32 minOperatingPeriod,uint16 revenueBps,uint16 firstReleaseBps,uint8 milestoneMode,uint16 minFeeBps,uint16 triggerWindowDays,uint16 stepUpBps,uint256 triggerRevenue))',
  'function fundingEscrow() view returns (uint256)',
  'function phase() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
]);
const factoryReadAbi = parseAbi(['function depositAllowed(address bond) view returns (bool)']);
const kuruReadAbi = parseAbi([
  'function getMarketParams() view returns (uint32 pricePrecision,uint96 sizePrecision,address baseAsset,uint256 baseAssetDecimals,address quoteAsset,uint256 quoteAssetDecimals,uint32 tickSize,uint96 minSize,uint96 maxSize,uint256 takerFeeBps,uint256 makerFeeBps)',
]);
const kuruTradeAbi = parseAbi([
  'function placeAndExecuteMarketBuy(uint96 size,uint256 minAmountOut,bool isMargin,bool isFillOrKill) payable returns (uint256)',
]);

fs.mkdirSync(outDir, { recursive: true });
const run = {
  task: scenario === 'kuru' ? 28 : 27,
  scenario,
  runId: `${scenario}-${new Date().toISOString()}`,
  startedAt: new Date().toISOString(),
  chainId: 10143,
  rpc: RPC,
  appOrigin: null,
  wallet: ADDRESS,
  bond,
  amount: scenario === 'kuru' ? '0.100000 USDC' : '1.000000 USDC',
  preflight: null,
  steps: [],
  transactions: [],
  walletRequests: [],
  consoleErrors: [],
  failedRequests: [],
  serverOutput: [],
  findings: [],
  final: null,
};
const persist = () => {
  const output = scenario === 'kuru'
    ? { ...(previousRun ?? {}), taskRuns: [...(previousRun?.taskRuns ?? []).filter(item => item.runId !== run.runId), run] }
    : run;
  fs.writeFileSync(`${logPath}.tmp`, JSON.stringify(output, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) + '\n');
  fs.renameSync(`${logPath}.tmp`, logPath);
};
const elapsed = () => Math.round(performance.now() - run.startedMonotonicMs);
let releaseLock;
let webProcess;
let rpcProxy;
let rpcProxyUrl;
let browser;
let context;
let page;
let origin;
let stepIndex = 0;
const acceptedWrites = new Set();
const txByKind = {};
let writesThisInvocation = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function webEnv() {
  return {
    ...process.env,
    KV_REST_API_URL: '',
    KV_REST_API_TOKEN: '',
    BONDRAIL_DEPLOYMENT: deployment.deployment,
    NEXT_PUBLIC_CHAIN_ID: '10143',
    NEXT_PUBLIC_RPC_URL: rpcProxyUrl,
    NEXT_PUBLIC_INDEXER_URL: 'https://indexer.dev.hyperindex.xyz/d0d9902/v1/graphql',
    NEXT_PUBLIC_USDC_ADDRESS: asset,
    NEXT_PUBLIC_FACTORY_ADDRESS: deployment.factory,
    NEXT_PUBLIC_PUMPLAB_BOND_ADDRESS: bond,
    NEXT_PUBLIC_AGENT_BOND_ADDRESS: deployment.issuers.agent.bond,
    NEXT_PUBLIC_VAULT_FACTORY_ADDRESS: deployment.vaultFactory ?? '',
    NEXT_PUBLIC_VAULT_ADDRESS: deployment.vault,
    NEXT_PUBLIC_CREDIT_REGISTRY_ADDRESS: deployment.creditRegistry,
    NEXT_TELEMETRY_DISABLED: '1',
  };
}

async function startWeb() {
  const port = await freePort();
  const proxyPort = await freePort();
  origin = `http://127.0.0.1:${port}`;
  rpcProxyUrl = `http://127.0.0.1:${proxyPort}`;
  run.appOrigin = origin;
  run.rpcProxy = { url: rpcProxyUrl, upstream: RPC, writesAllowed: false };
  const readOnlyMethods = new Set([
    'eth_call', 'eth_chainId', 'net_version', 'eth_blockNumber', 'eth_getBalance', 'eth_getTransactionCount',
    'eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_estimateGas', 'eth_gasPrice',
    'eth_maxPriorityFeePerGas', 'eth_getBlockByNumber', 'eth_feeHistory', 'eth_getCode', 'eth_getLogs',
    'eth_syncing', 'eth_coinbase', 'eth_protocolVersion', 'eth_getBlockTransactionCountByHash',
    'eth_getBlockTransactionCountByNumber', 'eth_getTransactionByBlockHashAndIndex',
    'eth_getTransactionByBlockNumberAndIndex', 'eth_getStorageAt', 'eth_getProof',
    'eth_getUncleByBlockHashAndIndex', 'eth_getUncleByBlockNumberAndIndex',
    'eth_getUncleCountByBlockHash', 'eth_getUncleCountByBlockNumber', 'eth_createAccessList',
  ]);
  let nextRpcSlot = 0;
  rpcProxy = createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'content-type');
    if (request.method === 'OPTIONS') { response.writeHead(204).end(); return; }
    if (request.method !== 'POST' || request.url !== '/') { response.writeHead(404).end(); return; }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const calls = Array.isArray(body) ? body : [body];
      if (calls.some(call => !readOnlyMethods.has(call.method))) {
        run.rpcRejected ??= [];
        run.rpcRejected.push({ at: new Date().toISOString(), methods: calls.map(call => call.method).filter(method => !readOnlyMethods.has(method)) });
        persist();
        response.writeHead(403, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Read-only RPC relay', methods: calls.map(call => call.method).filter(method => !readOnlyMethods.has(method)) }));
        return;
      }
      const forward = async call => {
        const waitMs = Math.max(0, nextRpcSlot - Date.now());
        nextRpcSlot = Math.max(Date.now(), nextRpcSlot) + 250;
        if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
        const upstream = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(call) });
        const text = await upstream.text();
        if (!upstream.ok) {
          run.rpcFailures ??= [];
          run.rpcFailures.push({ at: new Date().toISOString(), status: upstream.status, method: call.method, response: text.slice(0, 500) });
          persist();
        }
        return { status: upstream.status, contentType: upstream.headers.get('content-type') ?? 'application/json', text };
      };
      const results = [];
      for (const call of calls) results.push(await forward(call));
      const status = Math.max(...results.map(result => result.status));
      const contentType = results[0]?.contentType ?? 'application/json';
      const responseBody = Array.isArray(body) ? `[${results.map(result => result.text).join(',')}]` : results[0].text;
      response.writeHead(status, { 'content-type': contentType });
      response.end(responseBody);
    } catch (error) {
      response.writeHead(502, { 'content-type': 'application/json' }).end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });
  await new Promise((resolve, reject) => { rpcProxy.once('error', reject); rpcProxy.listen(proxyPort, '127.0.0.1', resolve); });
  webProcess = spawn(process.execPath, [
    path.join(root, 'apps/web/node_modules/next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', String(port),
  ], {
    cwd: path.join(root, 'apps/web'),
    env: webEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const stream of [webProcess.stdout, webProcess.stderr]) {
    stream.on('data', chunk => {
      run.serverOutput.push(String(chunk).trim().slice(0, 500));
      if (run.serverOutput.length > 60) run.serverOutput.shift();
      persist();
    });
  }
  const until = Date.now() + 180_000;
  while (Date.now() < until) {
    if (webProcess.exitCode !== null) throw new Error(`Local web process exited (${webProcess.exitCode})`);
    try {
      const response = await fetch(origin, { signal: AbortSignal.timeout(2500) });
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Timed out waiting for local web app');
}

async function seedLocalKuruRegistry() {
  const query = new URLSearchParams({
    accounts: deployment.issuers.pumplab.account,
    bonds: bond,
  });
  const response = await fetch(`https://bondrail.vercel.app/api/registry?${query}`, { signal: AbortSignal.timeout(15_000), cache: 'no-store' });
  assert(response.ok, `Local registry seed refused: published registry returned ${response.status}`);
  const published = await response.json();
  const profileRecord = published.profiles?.[deployment.issuers.pumplab.account.toLowerCase()];
  const kuruRecord = published.kuru?.[bond.toLowerCase()];
  assert(profileRecord?.profile && profileRecord.signature, 'Local registry seed refused: published PumpLab profile is missing');
  assert(kuruRecord?.market?.toLowerCase() === kuruMarket.toLowerCase(), 'Local registry seed refused: published PumpLab Kuru market differs from the manifest');
  assert(kuruRecord?.vault?.toLowerCase() === kuruVault.toLowerCase(), 'Local registry seed refused: published PumpLab Kuru vault differs from the manifest');
  const seed = async body => {
    const result = await fetch(`${origin}/api/registry`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await result.json();
    assert(result.ok, `Local registry seed failed: ${data.error ?? result.status}`);
    return data;
  };
  await seed({ type: 'profile', profile: profileRecord.profile, signature: profileRecord.signature });
  await seed({ type: 'kuru', tx: kuruRecord.tx });
  const check = await fetch(`${origin}/api/registry?${query}`, { signal: AbortSignal.timeout(10_000), cache: 'no-store' });
  assert(check.ok, 'Local registry seed verification request failed');
  const local = await check.json();
  assert(local.kuru?.[bond.toLowerCase()]?.market?.toLowerCase() === kuruMarket.toLowerCase(), 'Local registry seed verification did not return the Kuru market');
  assert(local.profiles?.[deployment.issuers.pumplab.account.toLowerCase()]?.profile?.name === profileRecord.profile.name, 'Local registry seed verification did not return the PumpLab profile');
  run.localRegistrySeed = { source: 'published registry, read-only fetch', profile: profileRecord.profile.name, market: kuruRecord.market, vault: kuruRecord.vault, verifiedLocally: true };
}

async function chainSnapshot() {
  const chainId = await client.getChainId();
  assert(chainId === 10143, `RPC returned chain ${chainId}, expected 10143`);
  const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
  const [mon, usdc, allowance, terms, escrow, phase, depositAllowed] = await Promise.all([
    client.getBalance({ address: ADDRESS, blockNumber }),
    client.readContract({ address: asset, abi: erc20Abi, functionName: 'balanceOf', args: [ADDRESS], blockNumber }),
    client.readContract({ address: asset, abi: erc20Abi, functionName: 'allowance', args: [ADDRESS, bond], blockNumber }),
    client.readContract({ address: bond, abi: bondReadAbi, functionName: 'terms', blockNumber }),
    client.readContract({ address: bond, abi: bondReadAbi, functionName: 'fundingEscrow', blockNumber }),
    client.readContract({ address: bond, abi: bondReadAbi, functionName: 'phase', blockNumber }),
    client.readContract({ address: deployment.factory, abi: factoryReadAbi, functionName: 'depositAllowed', args: [bond], blockNumber }),
  ]);
  return {
    at: new Date().toISOString(),
    blockNumber,
    chainId,
    mon: formatUnits(mon, 18),
    usdc: formatUnits(usdc, 6),
    allowance: formatUnits(allowance, 6),
    allowanceRaw: allowance.toString(),
    raiseAmount: formatUnits(terms.raiseAmount, 6),
    fundingEscrow: formatUnits(escrow, 6),
    remainingRaise: (terms.raiseAmount - escrow).toString(),
    phase: Number(phase),
    depositAllowed,
  };
}

async function kuruSnapshot() {
  const chainId = await client.getChainId();
  assert(chainId === 10143, `RPC returned chain ${chainId}, expected 10143`);
  const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
  const [mon, usdc, allowance, claims, phase, params, vaultCode] = await Promise.all([
    client.getBalance({ address: ADDRESS, blockNumber }),
    client.readContract({ address: asset, abi: erc20Abi, functionName: 'balanceOf', args: [ADDRESS], blockNumber }),
    client.readContract({ address: asset, abi: erc20Abi, functionName: 'allowance', args: [ADDRESS, kuruMarket], blockNumber }),
    client.readContract({ address: bond, abi: erc20Abi, functionName: 'balanceOf', args: [ADDRESS], blockNumber }),
    client.readContract({ address: bond, abi: bondReadAbi, functionName: 'phase', blockNumber }),
    client.readContract({ address: kuruMarket, abi: kuruReadAbi, functionName: 'getMarketParams', blockNumber }),
    client.getCode({ address: kuruVault, blockNumber }),
  ]);
  assert(vaultCode && vaultCode !== '0x', 'Abort: configured Kuru vault has no deployed code');
  assert(params[2].toLowerCase() === bond.toLowerCase(), 'Abort: Kuru base asset is not the PumpLab claim token');
  assert(params[4].toLowerCase() === asset.toLowerCase(), 'Abort: Kuru quote asset is not USDC');
  return {
    at: new Date().toISOString(), blockNumber, chainId,
    mon: formatUnits(mon, 18), usdc: formatUnits(usdc, 6), usdcRaw: usdc.toString(),
    allowance: formatUnits(allowance, 6), allowanceRaw: allowance.toString(),
    claims: formatUnits(claims, 6), claimsRaw: claims.toString(), phase: Number(phase),
    market: kuruMarket, vault: kuruVault,
    pricePrecision: params[0], sizePrecision: params[1].toString(),
    baseAsset: params[2], quoteAsset: params[4], minSize: params[7].toString(),
  };
}

function validateWalletRequest(tx) {
  assert(tx?.from?.toLowerCase() === ADDRESS.toLowerCase(), 'Wallet rejected: unauthorized sender');
  assert(BigInt(tx.value ?? 0) === 0n, 'Wallet rejected: nonzero native value');
  if (tx.chainId !== undefined) assert(BigInt(tx.chainId) === 10143n, 'Wallet rejected: wrong transaction chain');
  assert(acceptedWrites.size < 2, 'Wallet rejected: transaction budget exhausted');

  if (scenario === 'kuru') {
    const allowedContracts = new Set([kuruMarket, kuruVault, kuruRouter].map(address => address.toLowerCase()));
    if (acceptedWrites.size === 0) {
      assert(tx.to?.toLowerCase() === asset.toLowerCase(), 'Wallet rejected: first Kuru transaction must target USDC');
      const call = decodeFunctionData({ abi: erc20Abi, data: tx.data });
      assert(call.functionName === 'approve', 'Wallet rejected: first Kuru transaction must be approve');
      assert(allowedContracts.has(call.args[0].toLowerCase()), 'Wallet rejected: Kuru approval spender is not an allowed Kuru contract');
      assert(call.args[0].toLowerCase() === kuruMarket.toLowerCase(), 'Wallet rejected: approval spender differs from the app configured Kuru market');
      assert(call.args[1] === amount, 'Wallet rejected: approval must be exactly 0.1 USDC');
      run.approvalSpender = call.args[0];
      return 'kuru-approve';
    }
    assert(allowedContracts.has(tx.to?.toLowerCase()), 'Wallet rejected: Kuru buy destination is not an allowed Kuru contract');
    assert(tx.to?.toLowerCase() === kuruMarket.toLowerCase(), 'Wallet rejected: buy destination differs from the app configured Kuru market');
    const call = decodeFunctionData({ abi: kuruTradeAbi, data: tx.data });
    const decimals = String(run.preflight.pricePrecision).length - 1;
    const expectedSize = BigInt(amount) * (10n ** BigInt(decimals)) / 1_000_000n;
    assert(call.functionName === 'placeAndExecuteMarketBuy', 'Wallet rejected: second Kuru transaction must be a market buy');
    assert(call.args[0] === expectedSize, 'Wallet rejected: Kuru order size differs from exactly 0.1 USDC');
    assert(call.args[1] > 0n && call.args[2] === false && call.args[3] === false, 'Wallet rejected: unexpected Kuru minimum output or order flags');
    run.buySize = call.args[0].toString();
    run.minimumClaims = call.args[1].toString();
    return 'kuru-buy';
  }

  if (acceptedWrites.size === 0) {
    assert(tx.to?.toLowerCase() === asset.toLowerCase(), 'Wallet rejected: first transaction must target USDC');
    const call = decodeFunctionData({ abi: erc20Abi, data: tx.data });
    assert(call.functionName === 'approve', 'Wallet rejected: first transaction must be approve');
    assert(call.args[0].toLowerCase() === bond.toLowerCase(), 'Wallet rejected: approval spender is not the new PumpLab bond');
    assert(call.args[1] === amount, 'Wallet rejected: approval must be exactly 1 USDC');
    return 'approve';
  }

  assert(tx.to?.toLowerCase() === bond.toLowerCase(), 'Wallet rejected: second transaction must target the new PumpLab bond');
  const call = decodeFunctionData({ abi: bondAbi, data: tx.data });
  assert(call.functionName === 'deposit', 'Wallet rejected: second transaction must be deposit');
  assert(call.args[0] === amount, 'Wallet rejected: deposit must be exactly 1 USDC');
  return 'deposit';
}

async function submitGuarded(tx) {
  let stage = 'validate';
  try {
    const kind = validateWalletRequest(tx);
    run.walletRequests.push({ at: new Date().toISOString(), kind, from: tx.from, to: tx.to, chainId: tx.chainId, value: tx.value, selector: tx.data?.slice(0, 10) });
    persist();
    if (kind === 'deposit') {
      stage = 'deposit preflight';
      const snapshot = await chainSnapshot();
      assert(snapshot.remainingRaise === amount.toString(), 'Deposit refused: remaining raise changed from exactly 1 USDC');
      assert(snapshot.phase === 0 && snapshot.depositAllowed, 'Deposit refused: raise is not open and eligible');
      assert(snapshot.allowanceRaw === amount.toString(), 'Deposit refused: allowance is not exactly 1 USDC');
    } else if (kind === 'kuru-buy') {
      stage = 'Kuru buy preflight';
      const snapshot = await kuruSnapshot();
      assert(snapshot.phase === 1, 'Buy refused: PumpLab is no longer Active');
      assert(snapshot.allowanceRaw === amount.toString(), 'Buy refused: Kuru allowance is not exactly 0.1 USDC');
      assert(BigInt(snapshot.usdcRaw) >= amount, 'Buy refused: USDC balance is below 0.1');
    }
    stage = 'gas reserve';
    await gasCheck();
    stage = 'load dedicated signer';
    const account = signer();
    const wallet = createWalletClient({ account, chain: monadTestnet, transport: http(RPC, { retryCount: 0 }) });
    const request = { account: ADDRESS, to: tx.to, data: tx.data, value: 0n };
    stage = 'simulate';
    await client.call(request);
    stage = 'estimate gas';
    const gas = (await client.estimateGas(request)) * 12n / 10n;
    assert(gas <= 1_500_000n, 'Wallet rejected: unexpected gas estimate');
    stage = 'prepare transaction';
    const prepared = await wallet.prepareTransactionRequest({ account, to: tx.to, data: tx.data, value: 0n, gas });
    await gasCheck(gas * (prepared.maxFeePerGas ?? prepared.gasPrice ?? 0n));
    stage = 'reserve journal';
    const journalKind = `ui-${kind}`;
    const priorReservation = ledger().actions.find(action => action.kind === journalKind && action.status === 'reserved' && !action.hash);
    const journalId = priorReservation?.id ?? reserve(journalKind, { to: tx.to, amount: amount.toString(), chainId: 10143, bond });
    stage = 'sign transaction';
    const serialized = await wallet.signTransaction(prepared);
    const hash = keccak256(serialized);
    update(journalId, { hash, status: 'signed', signedAt: new Date().toISOString() });
    run.transactions.push({ kind, hash, journalId, submittedAt: new Date().toISOString(), status: 'submitted' });
    persist();
    stage = 'broadcast transaction';
    await broadcastAndConfirm(serialized, hash, journalId);
    acceptedWrites.add(kind);
    writesThisInvocation++;
    txByKind[kind] = hash;
    return hash;
  } catch (error) {
    run.walletGuardErrors ??= [];
    run.walletGuardErrors.push({ at: new Date().toISOString(), stage, error: error instanceof Error ? error.message : String(error) });
    persist();
    throw error;
  }
}

async function takeStep(name, details = {}) {
  const screenshot = `${scenario === 'kuru' ? 'kuru-' : ''}${String(++stepIndex).padStart(2, '0')}-${name}.png`;
  const text = await page.locator('body').innerText().catch(() => '');
  await page.screenshot({ path: path.join(outDir, screenshot), fullPage: false, animations: 'disabled' });
  run.steps.push({ name, elapsedMs: elapsed(), at: new Date().toISOString(), url: page.url(), screenshot, observedText: text, ...details });
  persist();
  console.log(`${name}: ${screenshot}`);
}

async function humanClick(locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  assert(box, 'Click target is not visible');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 18 });
  await page.waitForTimeout(450);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(900);
}

async function waitForStatus(re, timeout = 90_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const status = page.getByRole('status').filter({ hasText: re }).last();
    if (await status.isVisible().catch(() => false)) return status;
    const alert = page.getByRole('alert').last();
    if (await alert.isVisible().catch(() => false)) {
      const message = (await alert.innerText().catch(() => '')).trim();
      if (message) throw new Error(`UI transaction error: ${message}`);
      run.emptyAlertsObserved ??= [];
      if (!run.emptyAlertsObserved.length) run.emptyAlertsObserved.push({ at: new Date().toISOString(), url: page.url() });
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`Timed out waiting for UI status ${String(re)}`);
}

async function inspectReceipt(kind) {
  const hash = txByKind[kind];
  assert(hash, `Missing ${kind} hash`);
  const receipt = await client.waitForTransactionReceipt({ hash, pollingInterval: 1500, timeout: 120_000 });
  const reread = await client.getTransactionReceipt({ hash });
  const record = run.transactions.find(tx => tx.kind === kind);
  Object.assign(record, {
    receiptStatus: reread.status,
    blockNumber: reread.blockNumber,
    gasUsed: reread.gasUsed,
    rereadAt: new Date().toISOString(),
    receipt: reread,
  });
  const journal = ledger();
  const entry = journal.actions.find(action => action.id === record.journalId);
  if (entry) update(record.journalId, { status: reread.status, receipt: reread, receiptReadAt: record.rereadAt });
  persist();
  assert(receipt.status === 'success' && reread.status === 'success', `${kind} receipt status is ${reread.status}`);
  return record;
}

async function broadcastAndConfirm(serialized, hash, journalId) {
  const broadcast = client.sendRawTransaction({ serializedTransaction: serialized })
    .then(value => ({ value }))
    .catch(error => ({ error }));
  const outcome = await Promise.race([
    broadcast,
    new Promise(resolve => setTimeout(() => resolve({ timeout: true }), 10_000)),
  ]);
  if (!outcome.timeout && outcome.error) {
    const receipt = await client.getTransactionReceipt({ hash }).catch(() => null);
    if (receipt?.status !== 'success') throw outcome.error;
  } else if (outcome.value && outcome.value.toLowerCase() !== hash.toLowerCase()) {
    throw new Error(`RPC returned ${outcome.value}, signed transaction hashes to ${hash}`);
  }
  const receipt = await client.waitForTransactionReceipt({ hash, pollingInterval: 1000, timeout: 120_000 });
  update(journalId, { status: receipt.status, receipt, receiptReadAt: new Date().toISOString() });
  assert(receipt.status === 'success', `Transaction ${hash} reverted`);
}

async function main() {
  if (scenario === 'kuru') return mainKuru();
  run.startedMonotonicMs = performance.now();
  if (verifyOnly && previousRun) {
    run.priorAttempt = { earlier: previousRun.priorAttempt ?? null, preflight: previousRun.priorAttempt?.preflight ?? previousRun.preflight, final: previousRun.final, steps: previousRun.steps.map(step => step.name), consoleErrors: previousRun.consoleErrors };
    run.steps = previousRun.steps;
    run.transactions = previousRun.transactions;
    run.findings = [...new Map((previousRun.findings ?? []).map(finding => {
      if (finding.title === 'PumpLab raise is missing from the markets list') {
        finding = {
          ...finding,
          severity: 'medium',
          title: 'Open PumpLab raise is hidden from Markets',
          detail: 'The open bond was reachable by direct URL, but /markets showed “Nothing raising right now” and counted one item as hidden because it lacked a signed profile.',
        };
      }
      if (finding.title === 'Wallet connection is not available from the landing page') {
        finding = { ...finding, title: 'Wallet connection requires opening the app first' };
      }
      return [finding.title, finding];
    })).values()];
    run.consoleErrors = previousRun.consoleErrors ?? [];
    run.failedRequests = previousRun.failedRequests ?? [];
    run.serverOutput = previousRun.serverOutput ?? [];
    stepIndex = run.steps.length;
    const calculatorEvidence = run.steps.find(step => step.name === 'bond-open' && /Claims received\n10/.test(step.observedText) && /Only\s+\$?1\.00\s+remains to fund/.test(step.observedText));
    if (calculatorEvidence && !run.findings.some(finding => finding.title === 'Calculator amount starts above the remaining raise')) {
      run.findings.push({ severity: 'medium', title: 'Calculator amount starts above the remaining raise', detail: 'The What you get calculator defaults to 10 USDC while only 1 USDC remains, and shows “This amount cannot be deposited in full” before the investor enters an amount.', screenshot: calculatorEvidence.screenshot });
    }
  }
  releaseLock = lock();
  const journal = ledger();
  const before = await chainSnapshot();
  run.preflight = before;
  const priorUiActions = journal.actions.filter(action => ['ui-approve', 'ui-deposit'].includes(action.kind));
  const depositWasRecorded = priorUiActions.some(action => action.kind === 'ui-deposit' && action.hash);
  let reconciledApproval;
  let reconciledDeposit;
  for (const action of priorUiActions) {
    if (action.kind === 'ui-approve' && action.hash && ['submitted', 'success'].includes(action.status)) {
      const [transaction, receipt] = await Promise.all([
        client.getTransaction({ hash: action.hash }).catch(() => null),
        client.getTransactionReceipt({ hash: action.hash }).catch(() => null),
      ]);
      assert(transaction && receipt?.status === 'success', 'Prior approval has no successful receipt; refusing any further write');
      assert(transaction.from.toLowerCase() === ADDRESS.toLowerCase() && transaction.to?.toLowerCase() === asset.toLowerCase() && transaction.value === 0n && transaction.chainId === 10143, 'Prior approval does not match the authorized sender, destination, value, and chain');
      const call = decodeFunctionData({ abi: erc20Abi, data: transaction.input });
      assert(call.functionName === 'approve' && call.args[0].toLowerCase() === bond.toLowerCase() && call.args[1] === amount, 'Prior approval calldata does not match the exact authorized spender and amount');
      assert(before.allowanceRaw === amount.toString() || (depositWasRecorded && before.allowanceRaw === '0'), 'Prior approval receipt is successful but exact allowance is not present');
      update(action.id, { status: 'success', receipt, receiptReadAt: new Date().toISOString() });
      reconciledApproval = { hash: action.hash, journalId: action.id, receiptStatus: receipt.status, blockNumber: receipt.blockNumber, receipt };
      const record = run.transactions.find(tx => tx.kind === 'approve');
      if (record) Object.assign(record, reconciledApproval, { status: receipt.status, receipt, reconciled: true });
      else run.transactions.push({ kind: 'approve', ...reconciledApproval, status: receipt.status, reconciled: true });
      acceptedWrites.add('approve');
      txByKind.approve = action.hash;
    } else if (action.kind === 'ui-deposit' && action.hash && ['submitted', 'success'].includes(action.status)) {
      const [transaction, receipt] = await Promise.all([
        client.getTransaction({ hash: action.hash }).catch(() => null),
        client.getTransactionReceipt({ hash: action.hash }).catch(() => null),
      ]);
      assert(transaction && receipt?.status === 'success', 'Prior deposit has no successful receipt; refusing to alter journal state');
      assert(transaction.from.toLowerCase() === ADDRESS.toLowerCase() && transaction.to?.toLowerCase() === bond.toLowerCase() && transaction.value === 0n && transaction.chainId === 10143, 'Prior deposit does not match the authorized sender, destination, value, and chain');
      const call = decodeFunctionData({ abi: bondAbi, data: transaction.input });
      assert(call.functionName === 'deposit' && call.args[0] === amount, 'Prior deposit calldata does not match the exact authorized amount');
      assert(before.remainingRaise === '0', 'Prior deposit receipt is successful but the raise is not full');
      const claims = await client.readContract({ address: bond, abi: bondReadAbi, functionName: 'balanceOf', args: [ADDRESS] });
      assert(claims === amount, 'Prior deposit receipt is successful but claim balance is not exactly 1');
      update(action.id, { status: 'success', receipt, receiptReadAt: new Date().toISOString() });
      reconciledDeposit = { hash: action.hash, journalId: action.id, receiptStatus: receipt.status, blockNumber: receipt.blockNumber, receipt };
      const record = run.transactions.find(tx => tx.kind === 'deposit');
      if (record) Object.assign(record, reconciledDeposit, { status: receipt.status, reconciled: true });
      else run.transactions.push({ kind: 'deposit', ...reconciledDeposit, status: receipt.status, reconciled: true });
      acceptedWrites.add('deposit');
      txByKind.deposit = action.hash;
    } else {
      assert(action.status === 'reserved' && !action.hash, `Smoke journal contains a signed or completed ${action.kind}; refusing another write`);
    }
  }
  if (!reconciledApproval) assert(before.allowanceRaw === '0', `Abort: existing allowance ${before.allowance} USDC would skip the required approval UI step`);
  run.journalRecovery = priorUiActions.map(action => ({ id: action.id, kind: action.kind, status: action.status, hash: action.hash ?? null, resume: action.hash ? 'verified successful receipt and exact calldata' : 'reuse this unsigned reservation' }));
  persist();
  assert(Number(before.mon) >= 0.03, `Abort: MON balance ${before.mon} is below 0.03`);
  assert(before.remainingRaise === (verifyOnly ? '0' : amount.toString()), `Abort: remaining raise is ${formatUnits(BigInt(before.remainingRaise), 6)} USDC, unexpected for ${verifyOnly ? 'verification' : 'initial run'}`);
  assert(before.phase === 0 && (verifyOnly || before.depositAllowed), 'Abort: PumpLab bond is not in the expected open phase');
  assert(Number(before.usdc) >= (verifyOnly ? 0 : 1), `Abort: USDC balance ${before.usdc} is below the required amount`);
  if (verifyOnly) assert(reconciledApproval && reconciledDeposit, 'Completed-run verification requires both exact transactions to have successful receipts');

  await startWeb();
  browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: process.env.HEADLESS === '1',
    args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
  });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, colorScheme: 'dark' });
  await context.exposeBinding('__smokeWallet', async ({ frame }, request) => {
    if (new URL(frame.url()).origin !== origin) throw new Error('Wallet origin refused');
    const { method, params = [] } = request;
    if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [ADDRESS];
    if (method === 'eth_chainId') return '0x279f';
    if (method === 'net_version') return '10143';
    if (method === 'wallet_switchEthereumChain') {
      assert(params[0]?.chainId === '0x279f', 'Wallet rejected chain switch');
      return null;
    }
    if (method === 'wallet_getCapabilities') return {};
    if (method === 'eth_sendTransaction') {
      try { return await submitGuarded(params[0]); }
      catch (error) {
        run.walletRequests.push({ at: new Date().toISOString(), method, error: error instanceof Error ? error.message : String(error) });
        persist();
        throw error;
      }
    }
    const readOnlyMethods = new Set([
      'eth_call', 'eth_estimateGas', 'eth_gasPrice', 'eth_maxPriorityFeePerGas', 'eth_getBlockByNumber',
      'eth_getTransactionCount', 'eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_getBalance',
      'eth_blockNumber', 'eth_feeHistory', 'eth_getCode', 'eth_getLogs',
    ]);
    if (!readOnlyMethods.has(method)) throw new Error(`Wallet rejected unsupported RPC method ${method}`);
    return client.request({ method, params });
  });
  await context.addInitScript(() => {
    const listeners = new Map();
    window.ethereum = {
      isBondrailDemo: true,
      isMetaMask: true,
      request: request => window.__smokeWallet(request),
      on: (event, listener) => listeners.set(event, [...(listeners.get(event) ?? []), listener]),
      removeListener: (event, listener) => listeners.set(event, (listeners.get(event) ?? []).filter(fn => fn !== listener)),
    };
  });
  page = await context.newPage();
  page.on('console', message => { if (message.type() === 'error') run.consoleErrors.push({ at: new Date().toISOString(), text: message.text() }); });
  page.on('pageerror', error => run.consoleErrors.push({ at: new Date().toISOString(), text: error.message }));
  page.on('requestfailed', request => run.failedRequests.push({ at: new Date().toISOString(), url: request.url(), error: request.failure()?.errorText }));
  page.on('response', response => { if (response.status() >= 400) run.failedRequests.push({ at: new Date().toISOString(), url: response.url(), status: response.status() }); });

  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1800);
  await takeStep('landing');
  const landingText = await page.locator('body').innerText();
  assert(!/\bConnect\b/.test(landingText), 'Landing route unexpectedly exposes a Connect control; update the recorded navigation step');
    if (!run.findings.some(finding => finding.title === 'Wallet connection requires opening the app first')) run.findings.push({ severity: 'low', title: 'Wallet connection requires opening the app first', detail: 'The landing page has an “Open app” action; wallet connection is only available after navigating to /markets.', screenshot: run.steps.at(-1).screenshot });
  const openApp = page.getByRole('link', { name: 'Open app', exact: true });
  await humanClick(openApp);
  await page.waitForURL('**/markets', { timeout: 30_000 });
  await page.waitForTimeout(2500);
  await takeStep('markets');

  await humanClick(page.getByRole('button', { name: 'Connect', exact: true }));
  await takeStep('wallet-menu');
  await humanClick(page.getByRole('menuitem', { name: 'Browser wallet', exact: true }));
  await page.getByRole('button', { name: 'Disconnect wallet' }).waitFor({ timeout: 30_000 });
  const connectedLabel = `0x${ADDRESS.slice(2, 6).toLowerCase()}…${ADDRESS.slice(-4).toLowerCase()}`;
  await page.getByRole('button').filter({ hasText: connectedLabel }).waitFor({ timeout: 15_000 });
  await page.waitForTimeout(900);
  await takeStep('wallet-connected', { address: ADDRESS, buttonLabel: connectedLabel });

  await page.waitForTimeout(4500);
  const pumpCard = page.locator(`a[href="/bonds/${bond}"]`).first();
  if (await pumpCard.count()) {
    await humanClick(pumpCard);
    await page.waitForURL(`**/bonds/${bond}`, { timeout: 30_000 });
  } else {
    if (!run.findings.some(finding => finding.title === 'Fully funded PumpLab raise disappears from the markets list before activation')) run.findings.push({ severity: 'high', title: 'Fully funded PumpLab raise disappears from the markets list before activation', detail: 'The bond remains in Funding and still allows withdrawals, but no card linking to it is rendered in /markets once the raise reaches 100%.', screenshot: run.steps.findLast(step => step.name === 'markets')?.screenshot });
    await page.goto(`${origin}/bonds/${bond}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  }
  await page.waitForTimeout(8000);
  await page.getByRole('heading', { name: 'PumpLab', exact: true }).waitFor({ timeout: 45_000 });
  const bondText = await page.locator('body').innerText();
  assert(/Raising/i.test(bondText), 'Bond page does not show the expected Raising phase');
  assert(/Deposit/.test(bondText), 'Bond page does not expose Deposit as its primary action');
  await takeStep('bond-open', { chainRemainingRaise: before.remainingRaise, expectedPhase: 'Funding', expectedBadge: 'Raising' });
  const expectedRemainingText = verifyOnly
    ? /Deposits paused: the raise is full and awaits activation/i
    : /Only\s+\$?1\.00\s+remains to fund/i;
  const remainingTextMatches = expectedRemainingText.test(bondText);
  run.uiAssertions ??= [];
  run.uiAssertions.push({ assertion: `detail page shows ${verifyOnly ? '0' : '1'} USDC remaining`, passed: remainingTextMatches, observed: bondText.match(/Only\s+\$?[\d,.]+\s+remains to fund/i)?.[0] ?? null, screenshot: run.steps.at(-1).screenshot });
  if (!remainingTextMatches && !verifyOnly) throw new Error('UI does not show that exactly 1 USDC remains in the raise');
  if (!remainingTextMatches) run.findings.push({ severity: 'high', title: 'Bond detail shows a stale remaining amount after the raise fills', detail: `On-chain remaining raise is 0 USDC, but the page says “${bondText.match(/Only\s+\$?[\d,.]+\s+remains to fund/i)?.[0] ?? 'no remaining amount'}”.`, screenshot: run.steps.at(-1).screenshot });

  if (verifyOnly) await humanClick(page.getByRole('button', { name: 'Withdraw', exact: true }).last());
  else await humanClick(page.getByRole('button', { name: 'Deposit', exact: true }).first());
  const amountInput = page.getByLabel(/Amount \(USDC\)/i);
  await amountInput.waitFor({ state: 'visible', timeout: 15_000 });
  await takeStep('deposit-form-open');
  if (!verifyOnly) {
    await amountInput.fill('1');
    await page.waitForTimeout(500);
    await takeStep('amount-entered', { amount: '1' });
  }
  let approval = reconciledApproval;
  if (reconciledApproval) {
    const nextAction = verifyOnly ? 'Withdraw' : 'Deposit';
    await page.getByRole('button', { name: nextAction, exact: true }).last().waitFor({ state: 'visible', timeout: 30_000 });
    await takeStep('approval-confirmed', { txHash: approval.hash, receiptStatus: approval.receiptStatus, reconciled: true, nextActionVisible: nextAction });
  } else {
    const approveButton = page.getByRole('button', { name: 'Approve USDC', exact: true });
    await approveButton.waitFor({ state: 'visible', timeout: 15_000 });
    await humanClick(approveButton);
    await takeStep('approval-submitted');
    const approvedStatus = await waitForStatus(/Approval: confirmed/i);
    approval = await inspectReceipt('approve');
    await page.getByRole('button', { name: 'Deposit', exact: true }).last().waitFor({ state: 'visible', timeout: 20_000 });
    await takeStep('approval-confirmed', { statusText: await approvedStatus.innerText(), txHash: approval.hash, receiptStatus: approval.receiptStatus });
  }

  let deposit = reconciledDeposit;
  let depositedStatus;
  if (!verifyOnly) {
    await humanClick(page.getByRole('button', { name: 'Deposit', exact: true }).last());
    await takeStep('deposit-submitted');
    depositedStatus = await waitForStatus(/Deposit: confirmed/i);
    deposit = await inspectReceipt('deposit');
    await page.waitForTimeout(2500);
  }
  const after = await chainSnapshot();
  assert(after.remainingRaise === '0', `Raise is not full after deposit; remaining is ${formatUnits(BigInt(after.remainingRaise), 6)} USDC`);
  assert(after.phase === 0, `Expected Funding phase until a separate activation; on-chain phase is ${after.phase}`);
  assert(acceptedWrites.size === 2, `Expected exactly two guarded transactions, observed ${acceptedWrites.size}`);
  const fullText = await page.locator('body').innerText();
  assert(/Raising/i.test(fullText), 'Full raise badge/phase is not visible after deposit');
  const remainingUiMatches = verifyOnly
    ? /Deposits paused: the raise is full and awaits activation/i.test(fullText)
    : /Only\s+\$?0\.00\s+remains to fund/i.test(fullText);
  run.uiAssertions.push({ assertion: 'detail page shows zero remaining after deposit', passed: remainingUiMatches, observed: fullText.match(/Only\s+\$?[\d,.]+\s+remains to fund/i)?.[0] ?? null });
  if (!remainingUiMatches && !verifyOnly) throw new Error('UI does not show zero remaining after the raise fills');
  await humanClick(page.getByText('Full terms & technical details', { exact: true }));
  const progress = page.getByRole('img', { name: /Funded/ });
  await progress.waitFor({ state: 'visible', timeout: 30_000 });
  const progressLabel = await progress.getAttribute('aria-label');
  const progressIsFull = /Funded 2(?:\.0+)?[, ]+To raise 0(?:\.0+)?/.test(progressLabel ?? '');
  run.uiAssertions.push({ assertion: 'funding progress is full', passed: progressIsFull, observed: progressLabel });
  if (!progressIsFull && !verifyOnly) throw new Error(`Progress ribbon is not full: ${progressLabel}`);
  if (!progressIsFull) run.findings.push({ severity: 'high', title: 'Funding progress remains partial after the raise fills', detail: `On-chain funding is 2 USDC / 2 USDC, but the progress label is “${progressLabel}”.`, screenshot: 'full-raise progress screenshot recorded in run.json' });
  const actionText = await page.locator('body').innerText();
  const claimsText = actionText.match(/Your claims\s+([\d,.]+)/i)?.[1] ?? '';
  const claimsMatch = /^1(?:\.0+)?$/.test(claimsText);
  run.uiAssertions.push({ assertion: 'bond action panel shows 1 claim', passed: claimsMatch, observed: claimsText });
  if (!claimsMatch && !verifyOnly) throw new Error(`Your claims does not show exactly 1: ${claimsText}`);
  if (!claimsMatch) run.findings.push({ severity: 'high', title: 'Bond action panel does not show the deposited claim', detail: `The claim field shows “${claimsText}” after a successful 1 USDC deposit.`, screenshot: run.steps.at(-1)?.screenshot });
  await takeStep('raise-full', { statusText: depositedStatus ? await depositedStatus.innerText() : 'Deposit receipt verified on chain', txHash: deposit.hash, receiptStatus: deposit.receiptStatus, after, phaseBadge: 'Raising', progressLabel });
  for (const finding of run.findings) {
    if (finding.title === 'Funding progress remains partial after the raise fills') finding.screenshot = run.steps.at(-1).screenshot;
  }

  await humanClick(page.getByRole('link', { name: 'Portfolio', exact: true }));
  await page.waitForURL('**/portfolio', { timeout: 30_000 });
  await page.getByRole('heading', { name: 'Your positions', exact: true }).waitFor({ timeout: 30_000 });
  await page.getByRole('heading', { name: 'PumpLab', exact: true }).waitFor({ timeout: 60_000 });
  const portfolioText = await page.locator('body').innerText();
  const portfolioHasPosition = /Claims\s*\[?1(?:\.0+)?\]?/.test(portfolioText);
  run.uiAssertions.push({ assertion: 'portfolio lists 1 PumpLab claim', passed: portfolioHasPosition, observed: portfolioText.match(/Claims[^\n]*/)?.[0] ?? null });
  if (!portfolioHasPosition && !verifyOnly) throw new Error('Portfolio does not list the new PumpLab 1 claim position');
  if (!portfolioHasPosition) run.findings.push({ severity: 'high', title: 'Portfolio omits the funded PumpLab position', detail: 'The on-chain claim balance is 1, but the portfolio page does not show the position.', screenshot: run.steps.at(-1).screenshot });
  await takeStep('portfolio-position', { position: 'PumpLab · 1 claim', statusText: portfolioText });
  const uiFailures = (run.uiAssertions ?? []).filter(assertion => !assertion.passed);
  run.final = { result: uiFailures.length ? 'completed_with_findings' : 'passed', verificationOnly: verifyOnly, after, approveHash: approval.hash, depositHash: deposit.hash, acceptedWrites: [...acceptedWrites], writesThisInvocation: verifyOnly ? 0 : acceptedWrites.size, uiFailureCount: uiFailures.length, findingCount: run.findings.length };
}

async function mainKuru() {
  run.startedMonotonicMs = performance.now();
  assert(kuruMarket && kuruVault, 'Abort: PumpLab deployment manifest is missing its Kuru market or vault');
  assert(kuruMarket.toLowerCase() === '0xebb8acc3b3c56b1707fd1b477a087afa196de92d', 'Abort: unexpected PumpLab Kuru market in manifest');
  assert(kuruVault.toLowerCase() === '0xc164269235beb2140ede1dc452c4de1f581d64ac', 'Abort: unexpected PumpLab Kuru vault in manifest');
  releaseLock = lock();
  const journal = ledger();
  const kuruActions = journal.actions.filter(action => ['ui-kuru-approve', 'ui-kuru-buy'].includes(action.kind));
  const completedBuy = kuruActions.find(action => action.kind === 'ui-kuru-buy' && action.hash);
  if (completedBuy) {
    assert(process.argv.includes('--verify-kuru-completed'), 'Abort: a Kuru buy already exists; use --verify-kuru-completed for read-only verification');
    return verifyKuruCompleted(kuruActions, completedBuy);
  }
  assert(!kuruActions.some(action => action.kind === 'ui-kuru-buy' && action.status !== 'reserved'), 'Abort: Kuru journal contains an incomplete or unrecognized buy action');
  const before = await kuruSnapshot();
  run.preflight = before;
  const approvalAction = kuruActions.find(action => action.kind === 'ui-kuru-approve');
  let reconciledApproval;
  if (approvalAction?.hash) {
    const [transaction, receipt] = await Promise.all([
      client.getTransaction({ hash: approvalAction.hash }).catch(() => null),
      client.getTransactionReceipt({ hash: approvalAction.hash }).catch(() => null),
    ]);
    assert(transaction && receipt?.status === 'success', 'Abort: prior Kuru approval hash has no successful receipt');
    assert(transaction.from.toLowerCase() === ADDRESS.toLowerCase() && transaction.to?.toLowerCase() === asset.toLowerCase() && transaction.value === 0n && transaction.chainId === 10143, 'Abort: prior Kuru approval sender, destination, value, or chain is wrong');
    const call = decodeFunctionData({ abi: erc20Abi, data: transaction.input });
    assert(call.functionName === 'approve' && call.args[0].toLowerCase() === kuruMarket.toLowerCase() && call.args[1] === amount, 'Abort: prior Kuru approval calldata does not match exact market and 0.1 USDC');
    assert(before.allowanceRaw === amount.toString(), 'Abort: prior Kuru approval succeeded but exact allowance is not present');
    run.approvalSpender = call.args[0];
    update(approvalAction.id, { status: 'success', receipt, receiptReadAt: new Date().toISOString() });
    reconciledApproval = { hash: approvalAction.hash, journalId: approvalAction.id, receiptStatus: receipt.status, blockNumber: receipt.blockNumber, receipt, reconciled: true };
    run.transactions.push({ kind: 'kuru-approve', ...reconciledApproval, status: receipt.status });
    acceptedWrites.add('kuru-approve');
    txByKind['kuru-approve'] = approvalAction.hash;
  } else {
    assert(!approvalAction || (approvalAction.status === 'reserved' && !approvalAction.hash), 'Abort: prior Kuru approval journal state is not recoverable');
    assert(before.allowanceRaw === '0', `Abort: existing Kuru allowance is ${before.allowance} USDC without a matching journaled approval`);
  }
  run.journalRecovery = kuruActions.map(action => ({ id: action.id, kind: action.kind, status: action.status, hash: action.hash ?? null, resume: action === approvalAction && reconciledApproval ? 'verified exact approval receipt and allowance' : 'reuse unsigned reservation' }));
  persist();
  assert(Number(before.mon) >= 0.03, `Abort: MON balance ${before.mon} is below 0.03`);
  assert(before.phase === 1, `Abort: PumpLab phase is ${before.phase}, expected Active (1)`);
  assert(before.allowanceRaw === (reconciledApproval ? amount.toString() : '0'), `Abort: Kuru allowance ${before.allowance} USDC does not match its journaled approval state`);
  assert(BigInt(before.usdcRaw) >= amount, `Abort: USDC balance ${before.usdc} is below 0.1`);
  assert(BigInt(before.pricePrecision) > 0n && BigInt(before.minSize) > 0n, 'Abort: Kuru market parameters are invalid');

  await startWeb();
  await seedLocalKuruRegistry();
  browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: process.env.HEADLESS === '1',
    args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
  });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, colorScheme: 'dark' });
  await context.exposeBinding('__smokeWallet', async ({ frame }, request) => {
    if (new URL(frame.url()).origin !== origin) throw new Error('Wallet origin refused');
    const { method, params = [] } = request;
    if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [ADDRESS];
    if (method === 'eth_chainId') return '0x279f';
    if (method === 'net_version') return '10143';
    if (method === 'wallet_switchEthereumChain') {
      assert(params[0]?.chainId === '0x279f', 'Wallet rejected chain switch');
      return null;
    }
    if (method === 'wallet_getCapabilities') return {};
    if (method === 'eth_sendTransaction') {
      try { return await submitGuarded(params[0]); }
      catch (error) {
        run.walletRequests.push({ at: new Date().toISOString(), method, error: error instanceof Error ? error.message : String(error) });
        persist();
        throw error;
      }
    }
    const readOnlyMethods = new Set([
      'eth_call', 'eth_estimateGas', 'eth_gasPrice', 'eth_maxPriorityFeePerGas', 'eth_getBlockByNumber',
      'eth_getTransactionCount', 'eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_getBalance',
      'eth_blockNumber', 'eth_feeHistory', 'eth_getCode', 'eth_getLogs',
    ]);
    if (!readOnlyMethods.has(method)) throw new Error(`Wallet rejected unsupported RPC method ${method}`);
    return client.request({ method, params });
  });
  await context.addInitScript(() => {
    const listeners = new Map();
    window.ethereum = {
      isBondrailDemo: true,
      isMetaMask: true,
      request: request => window.__smokeWallet(request),
      on: (event, listener) => listeners.set(event, [...(listeners.get(event) ?? []), listener]),
      removeListener: (event, listener) => listeners.set(event, (listeners.get(event) ?? []).filter(fn => fn !== listener)),
    };
  });
  page = await context.newPage();
  page.on('console', message => { if (message.type() === 'error') run.consoleErrors.push({ at: new Date().toISOString(), text: message.text() }); });
  page.on('pageerror', error => run.consoleErrors.push({ at: new Date().toISOString(), text: error.message }));
  page.on('requestfailed', request => run.failedRequests.push({ at: new Date().toISOString(), url: request.url(), error: request.failure()?.errorText }));
  page.on('response', response => { if (response.status() >= 400) run.failedRequests.push({ at: new Date().toISOString(), url: response.url(), status: response.status() }); });

  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1800);
  await takeStep('landing');
  await humanClick(page.getByRole('link', { name: 'Open app', exact: true }));
  await page.waitForURL('**/markets', { timeout: 30_000 });
  await page.waitForTimeout(2500);
  await takeStep('markets-raising');
  run.marketsObservation = { raisingTab: await page.locator('body').innerText() };
  await humanClick(page.getByRole('button', { name: 'Connect', exact: true }));
  await takeStep('wallet-menu');
  await humanClick(page.getByRole('menuitem', { name: 'Browser wallet', exact: true }));
  await page.getByRole('button', { name: 'Disconnect wallet' }).waitFor({ timeout: 30_000 });
  const connectedLabel = `0x${ADDRESS.slice(2, 6).toLowerCase()}…${ADDRESS.slice(-4).toLowerCase()}`;
  await page.getByRole('button').filter({ hasText: connectedLabel }).waitFor({ timeout: 15_000 });
  await page.waitForTimeout(1200);
  await humanClick(page.getByRole('tab', { name: 'Trading', exact: true }));
  await page.waitForTimeout(4000);
  const tradingText = await page.locator('body').innerText();
  run.marketsObservation.tradingTab = tradingText;
  run.marketsObservation.pumpLabListed = tradingText.includes('PumpLab');
  await takeStep('markets-trading', { pumpLabListed: run.marketsObservation.pumpLabListed });
  if (!run.marketsObservation.pumpLabListed) {
    const showAll = page.getByRole('button', { name: /Show all \(1 hidden/ });
    await showAll.waitFor({ state: 'visible', timeout: 10_000 });
    run.findings.push({
      severity: 'medium',
      title: 'Active PumpLab market is hidden from the Trading list by default',
      detail: 'Markets → Trading showed “No live bonds” and one hidden item with generic possible causes, despite PumpLab being Active with its configured Kuru market. “Show all” exposed the PumpLab card.',
      screenshot: run.steps.find(step => step.name === 'markets-trading')?.screenshot,
    });
    await humanClick(showAll);
    await page.waitForTimeout(1200);
    run.marketsObservation.pumpLabRevealedByShowAll = (await page.locator('body').innerText()).includes('PumpLab');
    await takeStep('markets-trading-expanded', { pumpLabRevealedByShowAll: run.marketsObservation.pumpLabRevealedByShowAll });
  }
  const pumpCard = page.getByRole('link', { name: /PumpLab/ }).first();
  await pumpCard.waitFor({ state: 'visible', timeout: 30_000 });
  await humanClick(pumpCard);
  await page.waitForURL(url => url.pathname.toLowerCase() === `/bonds/${bond}`.toLowerCase(), { timeout: 30_000 });
  await page.waitForTimeout(7000);
  await page.getByRole('heading', { name: 'PumpLab', exact: true }).waitFor({ timeout: 45_000 });
  const detailText = await page.locator('body').innerText();
  assert(before.phase === 1 && /Repaying/i.test(detailText), 'PumpLab detail page does not represent the on-chain Active phase as Repaying');
  await takeStep('bond-active', { onChainPhase: 'Active', phaseLabel: 'Repaying', market: kuruMarket });
  const primaryBuy = page.getByRole('button', { name: 'Buy claims', exact: true }).first();
  await primaryBuy.waitFor({ state: 'visible', timeout: 20_000 });
  await humanClick(primaryBuy);
  await page.getByText('Best ask', { exact: true }).waitFor({ state: 'visible', timeout: 20_000 });
  const tradePanelText = await page.locator('body').innerText();
  assert(tradePanelText.toLowerCase().includes(kuruMarket.slice(2, 6).toLowerCase()) && tradePanelText.toLowerCase().includes(kuruMarket.slice(-4).toLowerCase()), 'Kuru trade panel does not identify the configured market');
  const amountInput = page.getByLabel(/Spend \(USDC\)/i);
  await amountInput.waitFor({ state: 'visible', timeout: 15_000 });
  const askText = await page.locator('body').innerText();
  const ask = askText.match(/Best ask\s*\n\s*([0-9]+(?:\.[0-9]+)?)/)?.[1];
  assert(ask, 'Kuru market price (Best ask) is not shown');
  await takeStep('buy-panel', { primaryAction: 'Buy claims', bestAsk: ask });
  await amountInput.fill('0.1');
  await page.waitForTimeout(2500);
  const previewBeforeApproval = await page.locator('body').innerText();
  const earlyClaims = previewBeforeApproval.match(/You receive\s*\n\s*([0-9,.]+) claims/i)?.[1];
  run.previewBeforeApproval = { available: !!earlyClaims, observed: earlyClaims ?? null };
  if (!earlyClaims) {
    run.findings.push({
      severity: 'medium',
      title: 'Kuru buy quote is hidden until after USDC approval',
      detail: 'After entering 0.1 USDC, the trade panel did not show expected claims or minimum received until allowance was approved. The requested preview-before-approval sequence was unavailable.',
      screenshot: null,
    });
    await takeStep('preview-awaits-approval', { spend: '0.1 USDC', previewVisible: false });
  }
  let approvalStatusText = reconciledApproval ? 'Approval receipt verified from durable journal' : '';
  if (!reconciledApproval) {
    const approveButton = page.getByRole('button', { name: 'Approve USDC', exact: true });
    await approveButton.waitFor({ state: 'visible', timeout: 20_000 });
    await humanClick(approveButton);
    await takeStep('approval-submitted');
    try {
      approvalStatusText = await (await waitForStatus(/Approve: confirmed/i)).innerText();
    } catch (error) {
      const pendingApproval = run.transactions.find(tx => tx.kind === 'kuru-approve' && tx.hash);
      if (!pendingApproval) throw error;
      run.findings.push({
        severity: 'medium',
        title: 'Trade panel did not confirm a successful USDC approval',
        detail: `The exact approval succeeded on chain, but the trade panel remained in “Confirm in your wallet…” and raised “${error instanceof Error ? error.message : String(error)}”. The durable journal and receipt verified the approval.`,
        screenshot: run.steps.find(step => step.name === 'approval-submitted')?.screenshot,
      });
      approvalStatusText = 'Approval verified on chain; UI confirmation did not render';
    }
  }
  const approval = await inspectReceipt('kuru-approve');
  await page.getByText('You receive', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForFunction(() => document.body.innerText.includes('Minimum received'), null, { timeout: 30_000 });
  await page.waitForTimeout(1000);
  const previewText = await page.locator('body').innerText();
  const expectedClaims = previewText.match(/You receive\s*\n\s*([0-9,.]+) claims/i)?.[1];
  assert(expectedClaims && Number(expectedClaims.replaceAll(',', '')) > 0, 'Kuru preview does not show expected claims greater than zero');
  run.preview = { spend: '0.1 USDC', expectedClaims, bestAsk: ask, minimumReceived: previewText.match(/Minimum received\s*\n\s*([^\n]+)/)?.[1] ?? null, afterApproval: true };
  await takeStep('buy-preview', run.preview);
  await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).some(button => button.textContent?.trim() === 'Buy claims' && !button.disabled), null, { timeout: 30_000 });
  await takeStep('approval-confirmed', { statusText: approvalStatusText, txHash: approval.hash, receiptStatus: approval.receiptStatus, spender: run.approvalSpender, reconciled: !!reconciledApproval });

  await humanClick(page.getByRole('button', { name: 'Buy claims', exact: true }).last());
  await takeStep('buy-submitted');
  let boughtStatusText;
  try {
    boughtStatusText = await (await waitForStatus(/Buy: confirmed/i)).innerText();
  } catch (error) {
    const pendingBuy = run.transactions.find(tx => tx.kind === 'kuru-buy' && tx.hash);
    if (!pendingBuy) throw error;
    const [transaction, receipt] = await Promise.all([
      client.getTransaction({ hash: pendingBuy.hash }).catch(() => null),
      client.getTransactionReceipt({ hash: pendingBuy.hash }).catch(() => null),
    ]);
    assert(transaction && receipt?.status === 'success', 'Buy UI failed and the journaled Kuru buy has no successful receipt');
    assert(transaction.from.toLowerCase() === ADDRESS.toLowerCase() && transaction.to?.toLowerCase() === kuruMarket.toLowerCase() && transaction.value === 0n && transaction.chainId === 10143, 'Journaled Kuru buy sender, destination, value, or chain is wrong');
    const order = decodeFunctionData({ abi: kuruTradeAbi, data: transaction.input });
    const decimals = String(before.pricePrecision).length - 1;
    const expectedSize = amount * (10n ** BigInt(decimals)) / 1_000_000n;
    assert(order.functionName === 'placeAndExecuteMarketBuy' && order.args[0] === expectedSize && order.args[1] > 0n && !order.args[2] && !order.args[3], 'Journaled Kuru buy calldata differs from exactly 0.1 USDC market buy');
    run.findings.push({
      severity: 'medium',
      title: 'Trade panel did not confirm a successful Kuru buy',
      detail: `The exact Kuru market buy succeeded on chain, but the trade panel raised “${error instanceof Error ? error.message : String(error)}”. The durable journal, decoded transaction, and receipt verified the buy.`,
      screenshot: run.steps.find(step => step.name === 'buy-submitted')?.screenshot,
    });
    update(pendingBuy.journalId, { status: 'success', receipt, receiptReadAt: new Date().toISOString() });
    pendingBuy.receiptStatus = receipt.status;
    pendingBuy.receipt = receipt;
    if (!acceptedWrites.has('kuru-buy')) {
      acceptedWrites.add('kuru-buy');
      writesThisInvocation++;
    }
    txByKind['kuru-buy'] = pendingBuy.hash;
    boughtStatusText = 'Buy verified on chain; UI confirmation did not render';
  }
  const buy = await inspectReceipt('kuru-buy');
  await page.waitForTimeout(2500);
  const after = await kuruSnapshot();
  assert(BigInt(after.claimsRaw) > BigInt(before.claimsRaw), `Claims did not increase: before ${before.claims}, after ${after.claims}`);
  assert(BigInt(before.usdcRaw) - BigInt(after.usdcRaw) === amount, `USDC spend was ${formatUnits(BigInt(before.usdcRaw) - BigInt(after.usdcRaw), 6)}, expected exactly 0.1`);
  assert(acceptedWrites.size === 2, `Expected exactly two guarded transactions, observed ${acceptedWrites.size}`);
  await takeStep('buy-confirmed', { statusText: boughtStatusText, txHash: buy.hash, receiptStatus: buy.receiptStatus, after });

  await humanClick(page.getByRole('link', { name: 'Portfolio', exact: true }));
  await page.waitForURL('**/portfolio', { timeout: 30_000 });
  await page.getByRole('heading', { name: 'Your positions', exact: true }).waitFor({ timeout: 30_000 });
  await page.getByRole('heading', { name: 'PumpLab', exact: true }).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(5000);
  const portfolioText = await page.locator('body').innerText();
  const positionLine = portfolioText.match(/Claims\s*\n\s*\[?([0-9,.]+)\]?/i)?.[1] ?? '';
  const uiClaims = Number(positionLine.replaceAll(',', ''));
  const priorClaims = Number(formatUnits(BigInt(before.claimsRaw), 6));
  const chainClaims = Number(formatUnits(BigInt(after.claimsRaw), 6));
  assert(uiClaims > priorClaims, 'Portfolio does not show a larger PumpLab claims position');
  run.uiAssertions = [
    { assertion: 'PumpLab Markets card is reachable under Trading', passed: run.marketsObservation.pumpLabListed || run.marketsObservation.pumpLabRevealedByShowAll },
    { assertion: 'Active detail page exposes Buy claims, market identity, and price', passed: !!ask },
    { assertion: 'Kuru preview shows expected claims after approval', passed: !!expectedClaims },
    { assertion: 'portfolio shows a larger PumpLab position', passed: uiClaims > priorClaims, observed: positionLine, chainClaims },
  ];
  await takeStep('portfolio-position', { uiClaims: positionLine, chainClaims: after.claims, claimBalanceBefore: before.claims, claimBalanceAfter: after.claims });
  run.final = {
    result: 'passed', after, approvalHash: approval.hash, buyHash: buy.hash,
    acceptedWrites: [...acceptedWrites], writesThisInvocation,
    approvalSpender: run.approvalSpender, buyDestination: kuruMarket,
    uiFailureCount: run.uiAssertions.filter(assertion => !assertion.passed).length,
    findingCount: run.findings.length,
  };
  for (const finding of run.findings) {
    if (finding.title === 'Kuru buy quote is hidden until after USDC approval') finding.screenshot = run.steps.find(step => step.name === 'preview-awaits-approval')?.screenshot;
  }
}

async function verifyKuruCompleted(actions, buyAction) {
  const approvalAction = actions.find(action => action.kind === 'ui-kuru-approve' && action.hash);
  assert(approvalAction, 'Completed Kuru buy has no journaled approval');
  const [approvalTx, approvalReceipt, buyTx, buyReceipt] = await Promise.all([
    client.getTransaction({ hash: approvalAction.hash }).catch(() => null),
    client.getTransactionReceipt({ hash: approvalAction.hash }).catch(() => null),
    client.getTransaction({ hash: buyAction.hash }).catch(() => null),
    client.getTransactionReceipt({ hash: buyAction.hash }).catch(() => null),
  ]);
  assert(approvalTx && approvalReceipt?.status === 'success', 'Completed Kuru approval receipt is missing or failed');
  assert(approvalTx.from.toLowerCase() === ADDRESS.toLowerCase() && approvalTx.to?.toLowerCase() === asset.toLowerCase() && approvalTx.chainId === 10143 && approvalTx.value === 0n, 'Completed Kuru approval sender, destination, chain, or value differs');
  const approvalCall = decodeFunctionData({ abi: erc20Abi, data: approvalTx.input });
  assert(approvalCall.functionName === 'approve' && approvalCall.args[0].toLowerCase() === kuruMarket.toLowerCase() && approvalCall.args[1] === amount, 'Completed Kuru approval calldata differs');
  assert(buyTx && buyReceipt?.status === 'success', 'Completed Kuru buy receipt is missing or failed');
  assert(buyTx.from.toLowerCase() === ADDRESS.toLowerCase() && buyTx.to?.toLowerCase() === kuruMarket.toLowerCase() && buyTx.chainId === 10143 && buyTx.value === 0n, 'Completed Kuru buy sender, destination, chain, or value differs');
  const buyCall = decodeFunctionData({ abi: kuruTradeAbi, data: buyTx.input });
  assert(buyCall.functionName === 'placeAndExecuteMarketBuy' && buyCall.args[0] === 1000n && buyCall.args[1] > 0n && !buyCall.args[2] && !buyCall.args[3], 'Completed Kuru buy calldata is not exactly a 0.1 USDC market order');
  const priorRun = [...(previousRun?.taskRuns ?? [])].reverse().find(item => item.steps?.some(step => step.name === 'buy-submitted'));
  const original = priorRun?.preflight;
  assert(original, 'Completed Kuru run is missing its pre-trade snapshot');
  const after = await kuruSnapshot();
  assert(BigInt(after.claimsRaw) > BigInt(original.claimsRaw), 'Completed Kuru buy did not increase the on-chain claim balance');
  assert(BigInt(original.usdcRaw) - BigInt(after.usdcRaw) === amount, 'Completed Kuru buy did not spend exactly 0.1 USDC');
  assert(after.allowanceRaw === '0', 'Completed Kuru order did not consume the exact 0.1 USDC allowance');
  update(approvalAction.id, { status: 'success', receipt: approvalReceipt, receiptReadAt: new Date().toISOString() });
  update(buyAction.id, { status: 'success', receipt: buyReceipt, receiptReadAt: new Date().toISOString() });
  run.preflight = original;
  run.after = after;
  run.journalRecovery = [approvalAction, buyAction].map(action => ({ kind: action.kind, hash: action.hash, receiptStatus: 'success', verificationOnly: true }));
  run.transactions = [
    { kind: 'kuru-approve', hash: approvalAction.hash, receiptStatus: approvalReceipt.status, blockNumber: approvalReceipt.blockNumber, journalId: approvalAction.id },
    { kind: 'kuru-buy', hash: buyAction.hash, receiptStatus: buyReceipt.status, blockNumber: buyReceipt.blockNumber, journalId: buyAction.id },
  ];
  acceptedWrites.add('kuru-approve');
  acceptedWrites.add('kuru-buy');
  txByKind['kuru-approve'] = approvalAction.hash;
  txByKind['kuru-buy'] = buyAction.hash;

  await startWeb();
  await seedLocalKuruRegistry();
  browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: process.env.HEADLESS === '1',
    args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
  });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, colorScheme: 'dark' });
  await context.exposeBinding('__smokeWallet', async ({ frame }, request) => {
    if (new URL(frame.url()).origin !== origin) throw new Error('Wallet origin refused');
    const { method, params = [] } = request;
    if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [ADDRESS];
    if (method === 'eth_chainId') return '0x279f';
    if (method === 'net_version') return '10143';
    if (method === 'wallet_switchEthereumChain') {
      assert(params[0]?.chainId === '0x279f', 'Wallet rejected chain switch');
      return null;
    }
    if (method === 'eth_sendTransaction') throw new Error('Verification-only wallet refused a transaction');
    const allowed = new Set(['eth_call', 'eth_estimateGas', 'eth_gasPrice', 'eth_maxPriorityFeePerGas', 'eth_getBlockByNumber', 'eth_getTransactionCount', 'eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_getBalance', 'eth_blockNumber', 'eth_feeHistory', 'eth_getCode', 'eth_getLogs']);
    if (!allowed.has(method)) throw new Error(`Verification-only wallet refused ${method}`);
    return client.request({ method, params });
  });
  await context.addInitScript(() => {
    const listeners = new Map();
    window.ethereum = { isBondrailDemo: true, isMetaMask: true, request: request => window.__smokeWallet(request), on: (event, listener) => listeners.set(event, [...(listeners.get(event) ?? []), listener]), removeListener: (event, listener) => listeners.set(event, (listeners.get(event) ?? []).filter(fn => fn !== listener)) };
  });
  page = await context.newPage();
  page.on('console', message => { if (message.type() === 'error') run.consoleErrors.push({ at: new Date().toISOString(), text: message.text() }); });
  page.on('pageerror', error => run.consoleErrors.push({ at: new Date().toISOString(), text: error.message }));
  page.on('requestfailed', request => run.failedRequests.push({ at: new Date().toISOString(), url: request.url(), error: request.failure()?.errorText }));
  page.on('response', response => { if (response.status() >= 400) run.failedRequests.push({ at: new Date().toISOString(), url: response.url(), status: response.status() }); });
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);
  stepIndex = priorRun.steps?.length ?? 10;
  await takeStep('verification-landing');
  await humanClick(page.getByRole('link', { name: 'Open app', exact: true }));
  await page.waitForURL('**/markets', { timeout: 30_000 });
  await page.waitForTimeout(2000);
  await humanClick(page.getByRole('button', { name: 'Connect', exact: true }));
  await humanClick(page.getByRole('menuitem', { name: 'Browser wallet', exact: true }));
  await page.getByRole('button', { name: 'Disconnect wallet' }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1000);
  await humanClick(page.getByRole('link', { name: 'Portfolio', exact: true }));
  await page.waitForURL('**/portfolio', { timeout: 30_000 });
  await page.getByRole('heading', { name: 'Your positions', exact: true }).waitFor({ timeout: 30_000 });
  await page.getByRole('heading', { name: 'PumpLab', exact: true }).waitFor({ timeout: 60_000 });
  await page.waitForFunction(previous => {
    const text = document.body.innerText;
    const match = text.match(/Claims\s*\n\s*\[?([0-9,.]+)\]?/i);
    return !!match && Number(match[1].replaceAll(',', '')) > Number(previous);
  }, formatUnits(BigInt(original.claimsRaw), 6), { timeout: 60_000 });
  const portfolioText = await page.locator('body').innerText();
  const position = portfolioText.match(/Claims\s*\n\s*\[?([0-9,.]+)\]?/i)?.[1] ?? '';
  await takeStep('portfolio-position', { claimBalanceBefore: original.claims, claimBalanceAfter: after.claims, portfolioClaims: position });
  run.uiAssertions = [{ assertion: 'portfolio shows the larger PumpLab claim position', passed: Number(position.replaceAll(',', '')) > Number(formatUnits(BigInt(original.claimsRaw), 6)), observed: position }];
  run.findings = [
    { severity: 'medium', title: 'Kuru buy quote is hidden until after USDC approval', detail: 'The first 0.1 USDC entry showed no expected claims or minimum received until approval. The preview was visible after the approval was confirmed on chain.', screenshot: [...(previousRun?.taskRuns ?? [])].flatMap(item => item.steps ?? []).findLast(step => step.name === 'preview-awaits-approval')?.screenshot ?? null },
    { severity: 'medium', title: 'Trade panel did not confirm successful approval or buy', detail: 'Both exact transactions succeeded on chain, but the panel stayed at “Confirm in your wallet…” and surfaced “Bond | Bondrail”. Receipts and decoded calldata were verified from the durable journal.', screenshot: priorRun.steps.find(step => step.name === 'failure')?.screenshot ?? null },
  ];
  run.marketsObservation = priorRun.marketsObservation;
  run.final = { result: 'completed_with_findings', verificationOnly: true, after, approvalHash: approvalAction.hash, buyHash: buyAction.hash, acceptedWrites: [...acceptedWrites], writesThisInvocation: 0, uiFailureCount: 0, findingCount: run.findings.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    await main();
  } catch (error) {
    run.final = { result: 'failed', error: error instanceof Error ? error.message : String(error), acceptedWrites: [...acceptedWrites] };
    if (page) {
      try { await takeStep('failure'); } catch {}
    }
    run.consoleErrors.push({ at: new Date().toISOString(), type: 'smoke-test', text: run.final.error });
    process.exitCode = 1;
  } finally {
    run.finishedAt = new Date().toISOString();
    run.durationMs = run.startedMonotonicMs === undefined ? null : elapsed();
    persist();
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (webProcess && webProcess.exitCode === null) {
      webProcess.kill('SIGTERM');
      await Promise.race([
        new Promise(resolve => webProcess.once('exit', resolve)),
        new Promise(resolve => setTimeout(resolve, 5000)),
      ]);
      if (webProcess.exitCode === null) webProcess.kill('SIGKILL');
    }
    if (rpcProxy) await new Promise(resolve => rpcProxy.close(resolve));
    releaseLock?.();
    console.log(JSON.stringify({ final: run.final, transactions: run.transactions.map(({ kind, hash, receiptStatus }) => ({ kind, hash, receiptStatus })), logPath }, (_, value) => typeof value === 'bigint' ? value.toString() : value, 2));
  }
}
