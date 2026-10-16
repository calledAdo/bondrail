// Unattended, isolated rehearsal. Never imports operational helpers until local-only env is installed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomBytes, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { decodeEventLog, decodeFunctionData, keccak256, stringToHex, type Address, type Hex } from 'viem';
import { authorizationTypes } from '../services/facilitator/src/index.ts';
import { classify, encodeObservationReport, observationDomain, observationTypes, policyHash, typedObservation,
  type WatchPolicy, type Observation } from '../services/observer/src/protocol.ts';
import { chromium } from '@playwright/test';
import { webEnvironment } from './web-env.ts';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const logs = path.join(root, '.data/e2e-local');
const keys = fs.mkdtempSync(path.join(os.tmpdir(), 'bondrail-e2e-'));
const children: ChildProcess[] = [];
const checks: { check: string; result: string }[] = [];
const protectedFiles = ['10143.json', 'archive/10143-slice-metropolis.json'].map(file => {
  const absolute = path.join(root, 'docs/deployments', file);
  return { file: absolute, bytes: fs.readFileSync(absolute) };
});
const generatedFiles = ['apps/web/next-env.d.ts', 'apps/web/tsconfig.json'].map(p => ({ file: path.join(root, p), bytes: fs.readFileSync(path.join(root, p)) }));
fs.mkdirSync(logs, { recursive: true });
const pass = (check: string) => { checks.push({ check, result: 'PASS' }); console.log(`PASS ${check}`); };
async function freePort() {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}
function start(label: string, command: string, args: string[], extra: NodeJS.ProcessEnv = {}) {
  const file = path.join(logs, `${label}.log`);
  const fd = fs.openSync(file, 'w');
  const child = spawn(command, args, { cwd: label === 'web-build' || label === 'web' ? path.join(root, 'apps/web') : root, env: { ...process.env, ...extra }, stdio: ['ignore', fd, fd] });
  fs.closeSync(fd);
  children.push(child);
  child.on('error', error => console.error(`${label}: ${error.message}`));
  return { child, file };
}
async function run(label: string, command: string, args: string[], extra: NodeJS.ProcessEnv = {}, expected = 0) {
  console.log(`RUN ${label}`);
  const { child, file } = start(label, command, args, extra);
  const timer = setTimeout(() => child.kill('SIGKILL'), 300_000);
  const code = await new Promise<number | null>((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
  clearTimeout(timer);
  if (code !== expected) throw new Error(`${label} exited ${code}\n${fs.readFileSync(file, 'utf8').slice(-12000)}`);
  return fs.readFileSync(file, 'utf8');
}
const script = (label: string, file: string, args: string[] = [], env: NodeJS.ProcessEnv = {}, expected = 0) =>
  run(label, process.execPath, ['--import', 'tsx', file, ...args], env, expected);
async function ready(label: string, url: string, child: ChildProcess, expected = 200) {
  for (let attempt = 0; attempt < 160; attempt++) {
    if (child.exitCode !== null || child.signalCode) throw new Error(`${label} stopped; see ${logs}`);
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1500) })).status === expected) return; } catch {}
    await delay(250);
  }
  throw new Error(`${label} readiness timeout`);
}
async function main() {
  const ports = await Promise.all([freePort(), freePort(), freePort(), freePort(), freePort()]);
  assert.equal(new Set(ports).size, ports.length, 'Unique service ports');
  const [rpcPort, facilitatorPort, agentPort, indexerPort, webPort] = ports;
  const rpc = `http://127.0.0.1:${rpcPort}`;
  const facilitator = `http://127.0.0.1:${facilitatorPort}`;
  const agentOrigin = `http://127.0.0.1:${agentPort}`;
  const indexer = `http://127.0.0.1:${indexerPort}`;
  // Override caller values; temporary role keys can never resolve to the operator's key stores.
  Object.assign(process.env, {
    BONDRAIL_CHAIN_ID: '31337', BONDRAIL_DEPLOYMENT: 'e2e', BONDRAIL_RPC_URL: rpc, BONDRAIL_RPC_URLS: rpc,
    // The local adapter scans chain state per query; it does not share a public-provider IP budget.
    BONDRAIL_RPC_RPS: '100', BONDRAIL_RPC_CONCURRENCY: '2',
    BONDRAIL_KEY_DIR: keys, BONDRAIL_KEY_PREFIX: 'e2e', BONDRAIL_DEPLOYER_KEY_FILE: path.join(keys, 'unused.key'),
    BONDRAIL_MIN_HISTORY: '60', BONDRAIL_ENV: 'local', BONDRAIL_STORE: 'local',
    RAISE_USDC: '2', CAP_USDC: '2.4', STAKE_USDC: '0.5', FUNDING_DAYS: '4', MATURITY_DAYS: '9',
    TRIGGER_BOND: 'pumplab', TRIGGER_REVENUE_USDC: '0.01', TRIGGER_DAYS: '1', STEP_UP_BPS: '4000',
    VAULT_BOND: 'pumplab', VAULT_ALLOCATE_USDC: '0.5', VAULT_DEPOSIT_USDC: '2', ACTIVATE: '0',
    WALLETS: '3', PER_WALLET_USDC: '0.3', AGENT_URL: `${agentOrigin}/api/oracle`,
    FACILITATOR_PORT: String(facilitatorPort), FACILITATOR_HOST: '127.0.0.1',
    FACILITATOR_DOMAIN_NAME: 'LOCAL TEST USDC', FACILITATOR_DOMAIN_VERSION: '1',
    LOCAL_AGENT_ORIGIN: agentOrigin, X402_FACILITATOR_URL: facilitator, INDEXER_PORT: String(indexerPort),
    INDEXER_URL: indexer, BONDRAIL_DATA_DIR: path.join(keys, 'journal'),
    ATTESTATION_EVIDENCE_DIR: path.join(logs, 'evidence'),
    NEXT_TELEMETRY_DISABLED: '1', BONDRAIL_WEB_DIST_DIR: '.next-e2e',
  });
  // Rehearsal owns this ignored local manifest; never delete or replace a public-chain manifest.
  for (const suffix of ['', '.pending']) fs.rmSync(path.join(root, `docs/deployments/31337-e2e.json${suffix}`), { force: true });
  await run('forge-build', path.join(os.homedir(), '.foundry/bin/forge'), ['build', '--root', 'contracts']);
  const { child: anvil } = start('anvil', path.join(os.homedir(), '.foundry/bin/anvil'),
    ['--host', '127.0.0.1', '--port', String(rpcPort), '--chain-id', '31337', '--silent']);
  // Import after overriding env; no top-level operational key access occurs in this module.
  const lib = await import('./lib.ts');
  for (let i = 0; ; i++) {
    try { assert.equal(await lib.publicClient.getChainId(), 31337); break; }
    catch (error) { if (i > 40 || anvil.exitCode !== null) throw error; await delay(100); }
  }
  const { account, artifact, publicClient: client, readDeployment, write } = lib;
  const read = (address: Address, contract: string, functionName: string, args: unknown[] = []) =>
    client.readContract({ address, abi: artifact(contract).abi, functionName, args }) as Promise<any>;
  await script('deploy', 'scripts/deploy.ts');
  let d = readDeployment();
  assert(d.vault && d.creditRegistry && d.templateHash);
  assert.equal(await read(d.factory, 'BondrailFactory', 'nativeTemplate', [d.templateHash]), true);
  assert.equal((await read(d.vault, 'BondrailVault', 'owner')).toLowerCase(), account('deployer').address.toLowerCase());
  assert.equal((await read(d.vault, 'BondrailVault', 'curator')).toLowerCase(), account('curator').address.toLowerCase());
  assert.equal((await read(d.creditRegistry, 'BondrailCreditRegistry', 'attester')).toLowerCase(), account('attester').address.toLowerCase());
  pass('Full deployment, role bindings and reviewed template');
  await script('deploy-refusal', 'scripts/deploy.ts', [], {}, 1);
  assert.match(fs.readFileSync(path.join(logs, 'deploy-refusal.log'), 'utf8'), /Refusing to overwrite/);
  await script('deploy-resume', 'scripts/deploy.ts', ['--force']);
  assert.equal(readDeployment().factory, d.factory);
  pass('Overwrite refused; --force resumes identical contracts');
  await script('vault-factory-plan', 'scripts/deploy-vault-factory.ts', ['--register-existing']);
  assert.equal(readDeployment().vaultFactory, undefined);
  await script('vault-factory-deploy', 'scripts/deploy-vault-factory.ts', ['--execute', '--force', '--register-existing']);
  d = readDeployment();
  assert(d.vaultFactory && d.vaultFactoryStartBlock);
  await script('vault-factory-resume', 'scripts/deploy-vault-factory.ts', ['--execute', '--force', '--register-existing']);
  assert.equal(readDeployment().vaultFactory, d.vaultFactory);
  const factoryReceipt = await write(account('deployer'), d.vaultFactory, artifact('BondrailVaultFactory').abi, 'createVault', [
    d.asset, 'Patient revenue', 'brPATIENT', account('curator').address, account('deployer').address,
    { description: 'Patient capital for new revenue raises', metadataHash: keccak256(stringToHex('patient-capital')) },
  ]);
  const created = factoryReceipt.logs.flatMap(log => {
    try { const e = decodeEventLog({ abi: artifact('BondrailVaultFactory').abi, data: log.data, topics: log.topics });
      return e.eventName === 'VaultCreated' ? [(e.args as unknown as { vault: Address }).vault] : []; } catch { return []; }
  });
  assert.equal(created.length, 1);
  const secondVault = created[0];
  assert.equal(await read(d.vaultFactory, 'BondrailVaultFactory', 'vaultCount'), 2n);
  const firstStrategy = await read(d.vaultFactory, 'BondrailVaultFactory', 'strategy', [d.vault]);
  const secondStrategy = await read(d.vaultFactory, 'BondrailVaultFactory', 'strategy', [secondVault]);
  assert.notEqual(firstStrategy.description, secondStrategy.description);
  await write(account('deployer'), d.asset, artifact('MockERC3009').abi, 'approve', [secondVault, 2_000_000n]);
  await write(account('deployer'), secondVault, artifact('BondrailVault').abi, 'deposit', [2_000_000n, account('deployer').address]);
  await write(account('deployer'), secondVault, artifact('BondrailVault').abi, 'withdraw', [100_000n, account('deployer').address, account('deployer').address]);
  assert.equal(await read(secondVault, 'BondrailVault', 'totalAssets'), 1_900_000n);
  pass('Vault factory plan/deploy/resume, exact legacy registration, two strategies, deposit and withdraw');

  await script('accounts', 'demo/scripts/setup-demo.ts', ['--force']);
  d = readDeployment();
  assert.equal(Object.keys(d.issuers).length, 3);
  const { child: fac } = start('facilitator', process.execPath, ['--import', 'tsx', 'scripts/service.ts', 'facilitator']);
  await ready('facilitator', `${facilitator}/supported`, fac);
  const { child: endpoint } = start('endpoint', process.execPath, ['--import', 'tsx', 'scripts/local-paid-endpoint.ts']);
  await ready('endpoint', `${agentOrigin}/api/oracle`, endpoint, 402);
  const payer = account('payer-0', { create: true });
  await write(account('deployer'), d.asset, artifact('MockERC3009').abi, 'mint', [payer.address, 200_000n]);
  const pay = async () => {
    const url = `${agentOrigin}/api/oracle`;
    const challenge = await fetch(url);
    assert.equal(challenge.status, 402);
    const offer = JSON.parse(Buffer.from(challenge.headers.get('payment-required')!, 'base64').toString());
    const required = offer.accepts[0];
    const now = (await client.getBlock()).timestamp;
    const authorization = { from: payer.address, to: d.issuers.agent!.account, value: '10000',
      validAfter: String(now - 1n), validBefore: String(now + 240n), nonce: `0x${randomBytes(32).toString('hex')}` as Hex };
    const signature = await payer.signTypedData({ domain: { name: 'LOCAL TEST USDC', version: '1', chainId: 31337, verifyingContract: d.asset },
      types: authorizationTypes, primaryType: 'TransferWithAuthorization', message: { ...authorization, value: 10000n, validAfter: now - 1n, validBefore: now + 240n } });
    const header = Buffer.from(JSON.stringify({ x402Version: 2, resource: offer.resource, accepted: required, payload: { authorization, signature } })).toString('base64');
    const response = await fetch(url, { headers: { 'payment-signature': header } });
    const body = await response.json() as { payment: { transaction: Hex } };
    assert.equal(response.status, 200, JSON.stringify(body));
    const receipt = await client.getTransactionReceipt({ hash: body.payment.transaction });
    const transaction = await client.getTransaction({ hash: receipt.transactionHash });
    assert.equal(transaction.to!.toLowerCase(), authorization.to.toLowerCase());
    assert.equal(decodeFunctionData({ abi: artifact('BondrailAccount').abi, data: transaction.input }).functionName, 'settle');
    const booked = await read(authorization.to, 'BondrailAccount', 'cumulativeRevenue');
    const replay = await fetch(url, { headers: { 'payment-signature': header } });
    assert.equal(replay.status, 200);
    assert.equal(await read(authorization.to, 'BondrailAccount', 'cumulativeRevenue'), booked);
    const events = receipt.logs.flatMap(log => { try { return [{ address: log.address, ...decodeEventLog({ abi: artifact('BondrailAccount').abi, data: log.data, topics: log.topics }) }]; } catch { return []; } });
    assert(events.some(e => e.eventName === 'Settled'));
    return { receipt, events };
  };
  await pay();
  await script('native-history', 'demo/scripts/traffic-launchpad.ts', ['pumplab', 'organic', '1']);
  await script('curve-history', 'demo/scripts/traffic-launchpad.ts', ['curvelab', 'organic', '1']);
  pass('Native traffic and x402 HTTP payments through facilitator/account.settle; replay safe');
  await script('bonds', 'demo/scripts/setup-demo.ts', ['--force']);
  d = readDeployment();
  for (const rec of Object.values(d.issuers)) {
    assert(rec.bond);
    assert.equal(await read(d.creditRegistry!, 'BondrailCreditRegistry', 'recorded', [rec.bond]), true);
  }
  const pump = d.issuers.pumplab!, agent = d.issuers.agent!, curve = d.issuers.curvelab!;
  assert.equal(await read(pump.bond!, 'BondrailBond', 'phase'), 1);
  assert.equal(await read(curve.bond!, 'BondrailBond', 'phase'), 0);
  assert.equal(await read(curve.bond!, 'BondrailBond', 'fundingEscrow'), 0n);
  assert.equal(await read(d.vault!, 'BondrailVault', 'costBasis', [pump.bond]), 500_000n);
  assert.equal(await read(d.vault!, 'BondrailVault', 'idleAssets'), 1_500_000n);
  assert.equal(await read(d.vault!, 'BondrailVault', 'totalAssets'), 2_000_000n);
  assert.equal(await read(d.vault!, 'BondrailVault', 'entryAssets'), 2_000_000n);
  pass('History warp, three recorded bonds, CurveLab open raise; vault allocates in Funding and NAV = 2 USDC');
  await write(account('curator'), secondVault, artifact('BondrailVault').abi, 'allocate', [curve.bond, 400_000n]);
  assert.equal(await read(secondVault, 'BondrailVault', 'costBasis', [curve.bond]), 400_000n);
  await write(account('curator'), secondVault, artifact('BondrailVault').abi, 'withdrawFromRaise', [curve.bond, 100_000n]);
  assert.equal(await read(secondVault, 'BondrailVault', 'costBasis', [curve.bond]), 300_000n);
  pass('Second vault allocates to eligible Funding bond and withdraws from raise within hard limits');

  // Local-only report from the configured observer over actual HTTP manifest + offer.
  const policy = d.watchPolicy as WatchPolicy;
  const manifest = await fetch(policy.manifestUrl);
  const offer = await fetch(policy.endpoints[0].url);
  const observed = classify(policy, { status: manifest.status, body: await manifest.text() }, policy.endpoints,
    [{ status: offer.status, header: offer.headers.get('payment-required')! }]);
  assert.equal(observed.result, 1);
  const at = (await client.getBlock()).timestamp;
  const observation: Observation = { bond: agent.bond!, policyHash: policyHash(policy), epoch: String(at / 30n), observedAt: String(at),
    expiresAt: String(at + 90n), result: observed.result, observedPayTo: observed.observedPayTo,
    offerHash: observed.offerHash, evidenceHash: keccak256(stringToHex('local HTTP observation')) };
  const observer = account('observer');
  const signature = await observer.signTypedData({ domain: observationDomain(policy), types: observationTypes,
    primaryType: 'Observation', message: typedObservation(observation) });
  await write(account('deployer'), d.covenant, artifact('BondrailCovenant').abi, 'onReport', ['0x', encodeObservationReport({ observation, signature, signer: observer.address })]);
  await script('activate-watched', 'scripts/activate-watched.ts');
  assert.equal(await read(agent.bond!, 'BondrailBond', 'phase'), 1);
  const beforeRevenue = await read(agent.bond!, 'BondrailBond', 'totalRevenueCollected') as bigint;
  const { events } = await pay();
  const revenue = events.find(e => e.eventName === 'Revenue')!.args as unknown as { toBond: bigint; toIssuer: bigint; amount: bigint };
  assert.equal(revenue.amount, 10_000n);
  assert.equal(revenue.toBond, 2_500n);
  assert.equal(revenue.toIssuer, 7_500n);
  assert.equal(await read(agent.bond!, 'BondrailBond', 'totalRevenueCollected'), beforeRevenue + 2500n);
  pass('Watched HTTP observation/activation; x402 repayment 2500 + issuer 7500 in same transaction');
  const beforeNative = await read(pump.bond!, 'BondrailBond', 'totalRevenueCollected') as bigint;
  await script('native-repayments', 'demo/scripts/traffic-launchpad.ts', ['pumplab', 'organic', '1']);
  assert((await read(pump.bond!, 'BondrailBond', 'totalRevenueCollected')) > beforeNative);
  const activation = await read(pump.bond!, 'BondrailBond', 'activationTime') as bigint;
  const target = (activation / 86400n + 2n) * 86400n + 1n;
  await client.request({ method: 'evm_setNextBlockTimestamp' as never, params: [Number(target)] as never });
  await client.request({ method: 'evm_mine' as never });
  await write(account('worker'), pump.bond!, artifact('BondrailBond').abi, 'checkTrigger');
  assert.equal(await read(pump.bond!, 'BondrailBond', 'triggered'), true);
  assert.equal(await read(pump.bond!, 'BondrailBond', 'revenueBps'), 4000);
  const exitNav = await read(d.vault!, 'BondrailVault', 'totalAssets') as bigint;
  const entryNav = await read(d.vault!, 'BondrailVault', 'entryAssets') as bigint;
  assert.equal(entryNav, 2_000_000n);
  assert(exitNav >= 1_750_000n && exitNav < entryNav);
  assert.equal(await read(d.vault!, 'BondrailVault', 'maxWithdraw', [account('vault-depositor').address]), 1_500_000n);
  pass(`Low-revenue trigger fires; share 40%; exit NAV ${exitNav}, entry NAV ${entryNav}; withdrawals idle-capped`);
  await script('setup-resume', 'demo/scripts/setup-demo.ts', ['--force']);
  assert.deepEqual(readDeployment().issuers, d.issuers);
  await script('deploy-after-demo', 'scripts/deploy.ts', ['--force']);
  assert.deepEqual(readDeployment().issuers, d.issuers);
  pass('Demo and full deploy reruns retain accounts/bonds/allocation');
  const { child: idx } = start('indexer', process.execPath, ['--import', 'tsx', 'scripts/dev-indexer.ts']);
  await ready('indexer', `${indexer}/health`, idx);
  const snapshot = await (await fetch(indexer)).json() as { data: { Bond: unknown[]; Payment: { source: string }[] } };
  assert.equal(snapshot.data.Bond.length, 3);
  assert(snapshot.data.Payment.some(p => p.source === 'x402'));
  await script('attest', 'scripts/service.ts', ['attester', '--relay']);
  const attested = await read(d.creditRegistry!, 'BondrailCreditRegistry', 'attestedProfile', [pump.account]);
  assert.equal(attested[2], true);
  assert.equal(attested[1].toLowerCase(), account('attester').address.toLowerCase());
  const evidence = fs.readFileSync(path.join(logs, 'evidence', `${attested[0].evidenceHash}.json`), 'utf8');
  assert.equal(keccak256(stringToHex(evidence)), attested[0].evidenceHash);
  assert((await read(d.creditRegistry!, 'BondrailCreditRegistry', 'onchainProfile', [pump.account])).complete);
  pass('Local indexer serves all bonds and x402; real attester relays valid, complete profile with matching evidence');
  const webEnv = webEnvironment(d, rpc, indexer);
  fs.writeFileSync(path.join(logs, 'web.env'), Object.entries(webEnv).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
  const require = createRequire(import.meta.url);
  const next = require.resolve('next/dist/bin/next', { paths: [path.join(root, 'apps/web')] });
  await run('web-build', process.execPath, [next, 'build', '--webpack'], webEnv);
  const { child: web } = start('web', process.execPath, [next, 'start', '--hostname', '127.0.0.1', '--port', String(webPort)], webEnv);
  await ready('web', `http://127.0.0.1:${webPort}/markets`, web);
  for (const route of ['/markets', '/vault', `/accounts/${pump.account}`]) {
    const response = await fetch(`http://127.0.0.1:${webPort}${route}`);
    assert.equal(response.status, 200, route);
  }
  const browser = await chromium.launch({ headless: true,
    ...(fs.existsSync(chromium.executablePath()) ? {} : { channel: 'chrome' }) });
  const page = await browser.newPage();
  try {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${webPort}/markets`);
    await page.getByRole('button', { name: /Show all/ }).click({ timeout: 30_000 });
    await page.getByRole('heading', { name: 'CurveLab', exact: true }).waitFor();
    await page.getByRole('tab', { name: 'Trading' }).click();
    await page.getByRole('heading', { name: 'PumpLab', exact: true }).waitFor();
    await page.getByRole('heading', { name: 'Oracle Agent', exact: true }).waitFor();
    await page.screenshot({ path: path.join(logs, 'markets.png'), fullPage: true });
    await page.goto(`http://127.0.0.1:${webPort}/vault`);
    await page.getByText('PumpLab Revenue Claim', { exact: true }).waitFor();
    assert.match(await page.locator('body').innerText(), /1\.75008/);
    await page.screenshot({ path: path.join(logs, 'vault.png'), fullPage: true });
    await page.goto(`http://127.0.0.1:${webPort}/accounts/${pump.account}`);
    await page.getByText(attested[0].evidenceHash, { exact: true }).waitFor();
    assert.match(await page.locator('body').innerText(), /1 of 1/);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(logs, 'credit.png'), fullPage: true });
  } catch (error) {
    fs.writeFileSync(path.join(logs, 'browser-failure.txt'), await page.locator('body').innerText());
    await page.screenshot({ path: path.join(logs, 'browser-failure.png'), fullPage: true });
    throw error;
  } finally { await browser.close(); }
  pass('Web production build from 31337-e2e; browser reads all bonds, vault NAV and attestation without page errors');
  for (const { file, bytes } of protectedFiles) assert.deepEqual(fs.readFileSync(file), bytes);
  pass('Current and judged deployment manifests unchanged; only isolated anvil used');
  const addresses = Object.entries({ USDC: d.asset, factory: d.factory, covenant: d.covenant, registry: d.creditRegistry, vault: d.vault,
    PumpLab: pump.source, 'PumpLab account': pump.account, 'PumpLab bond': pump.bond, 'Agent account': agent.account, 'Agent bond': agent.bond,
    'CurveLab account': curve.account, 'CurveLab bond': curve.bond });
  console.table(addresses.map(([contract, address]) => ({ contract, address })));
  console.table(checks);
  const result = { deployment: 'docs/deployments/31337-e2e.json', addresses: Object.fromEntries(addresses), checks,
    protectedSha256: Object.fromEntries(protectedFiles.map(({ file, bytes }) =>
      [path.relative(root, file), createHash('sha256').update(bytes).digest('hex')])), completedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(logs, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(`E2E LOCAL PASS (${checks.length} checks). Logs: ${logs}. Services stop automatically.`);
}
async function cleanup() {
  for (const child of [...children].reverse()) {
    if (child.exitCode !== null || child.signalCode) continue;
    child.kill('SIGTERM');
    await Promise.race([new Promise<void>(resolve => child.once('exit', () => resolve())), delay(3000)]);
    if (child.exitCode === null && !child.signalCode) child.kill('SIGKILL');
  }
  fs.rmSync(keys, { recursive: true, force: true });
  for (const { file, bytes } of generatedFiles) if (!fs.readFileSync(file).equals(bytes)) fs.writeFileSync(file, bytes);
  for (const { file, bytes } of protectedFiles)
    assert.deepEqual(fs.readFileSync(file), bytes, `Public manifest must remain untouched: ${file}`);
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void cleanup().finally(() => process.exit(1)); });
main().catch((error: unknown) => { console.error(error instanceof Error ? error.stack : error); process.exitCode = 1; }).finally(cleanup);
