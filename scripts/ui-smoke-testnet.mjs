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
const amount = 1_000_000n;
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

fs.mkdirSync(outDir, { recursive: true });
const run = {
  task: 27,
  startedAt: new Date().toISOString(),
  chainId: 10143,
  rpc: RPC,
  appOrigin: null,
  wallet: ADDRESS,
  bond,
  amount: '1.000000 USDC',
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
  fs.writeFileSync(`${logPath}.tmp`, JSON.stringify(run, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) + '\n');
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

function validateWalletRequest(tx) {
  assert(tx?.from?.toLowerCase() === ADDRESS.toLowerCase(), 'Wallet rejected: unauthorized sender');
  assert(BigInt(tx.value ?? 0) === 0n, 'Wallet rejected: nonzero native value');
  if (tx.chainId !== undefined) assert(BigInt(tx.chainId) === 10143n, 'Wallet rejected: wrong transaction chain');
  assert(acceptedWrites.size < 2, 'Wallet rejected: transaction budget exhausted');

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
  const screenshot = `${String(++stepIndex).padStart(2, '0')}-${name}.png`;
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
