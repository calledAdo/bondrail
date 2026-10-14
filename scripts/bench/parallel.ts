// Payment contention harness. Only local mode creates fixtures; Monad uses supplied, funded fixtures.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import {
  BaseError, createPublicClient, createWalletClient, defineChain, encodeFunctionData,
  getAddress, http, keccak256, parseAbi, parseEther, parseEventLogs, parseSignature,
  toHex, zeroAddress, type Abi, type Address, type Hex, type LocalAccount,
  type TypedData, type TypedDataDomain,
} from 'viem';
import { mnemonicToAccount, privateKeyToAccount } from 'viem/accounts';
import { monadTestnet } from 'viem/chains';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const env = process.env;
function integer(name: string, fallback: number, min: number, max: number) {
  const n = Number(env[name] ?? fallback);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`${name}: expected ${min}..${max}`);
  return n;
}
const mode = env.BENCH_CHAIN ?? 'anvil';
if (mode !== 'anvil' && mode !== 'monad') throw new Error('BENCH_CHAIN must be anvil or monad');
const n = integer('BENCH_WALLETS', 20, 2, 256);
const m = integer('BENCH_PAYMENTS', 5, 1, 1000);
const warmups = integer('BENCH_WARMUPS', 1, 0, 10);
const pollMs = integer('BENCH_POLL_MS', 100, 10, 10_000);
const timeoutMs = integer('BENCH_TIMEOUT_MS', 120_000, 1000, 600_000);
const blockSeconds = integer('BENCH_BLOCK_SECONDS', 1, 1, 60);
const value = BigInt(env.BENCH_AMOUNT ?? '1000000');
if (value <= 0n) throw new Error('BENCH_AMOUNT must be positive (smallest token units)');
const order = env.BENCH_ORDER ?? 'shared-first';
if (order !== 'shared-first' && order !== 'separate-first') throw new Error('Invalid BENCH_ORDER');
const bondMode = env.BENCH_BOND ?? 'passthrough';
if (bondMode !== 'passthrough' && bondMode !== 'active') throw new Error('Invalid BENCH_BOND');
const chain = mode === 'monad' ? monadTestnet : defineChain({
  id: 31337, name: 'Anvil', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['http://127.0.0.1:8545'] } },
});
const rpc = env.BENCH_RPC_URL ?? chain.rpcUrls.default.http[0];
// No retries: ambiguous broadcasts must be reported, not silently resubmitted or timed twice.
const client = createPublicClient({ chain, transport: http(rpc, { retryCount: 0 }), pollingInterval: pollMs });
const wallet = (account: LocalAccount) => createWalletClient({
  account, chain, transport: http(rpc, { retryCount: 0 }),
});
const accountAbi = parseAbi([
  'function asset() view returns (address)', 'function activeBond() view returns (address)',
  'function cumulativeRevenue() view returns (uint256)', 'function paymentCount() view returns (uint64)',
  'function settle(address from,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,uint8 v,bytes32 r,bytes32 s)',
]);
const tokenAbi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function eip712Domain() view returns (bytes1 fields,string name,string version,uint256 chainId,address verifyingContract,bytes32 salt,uint256[] extensions)',
  'function DOMAIN_SEPARATOR() view returns (bytes32)',
]);
const bondAbi = parseAbi([
  'function phase() view returns (uint8)', 'function remainingRevenueCap() view returns (uint256)',
  'function revenueBps() view returns (uint16)',
]);
const types = { TransferWithAuthorization: [
  { name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' },
  { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
] } as const;
type Fixture = { asset: Address; sharedAccount: Address; separateAccounts: Address[] };
type Row = {
  payer: Address; account: Address; sequence: number; nonce: number; hash: Hex;
  broadcastAt?: string; broadcastMs?: number; latencyMs?: number; blockNumber?: string;
  transactionIndex?: number; gasUsed?: string; status: 'pending' | 'success' | 'reverted' | 'error'; error?: string;
};
type Prepared = { raw: Hex; row: Row };
function describe(error: unknown) {
  return error instanceof BaseError ? error.shortMessage : error instanceof Error ? error.message : 'Unknown error';
}
function artifact(name: string): { abi: Abi; bytecode: Hex } {
  const a = JSON.parse(fs.readFileSync(path.join(root, `contracts/out/${name}.sol/${name}.json`), 'utf8'));
  return { abi: a.abi, bytecode: a.bytecode.object };
}
async function receipt(hash: Hex) {
  return client.waitForTransactionReceipt({ hash, pollingInterval: pollMs, timeout: timeoutMs, confirmations: 1 });
}
async function successful(hash: Hex) {
  const r = await receipt(hash);
  if (r.status !== 'success') throw new Error(`Setup transaction reverted: ${hash}`);
  return r;
}
// Only called after checking both chain ID and web3_clientVersion. Never used in Monad mode.
async function anvil(method: string, params: unknown[]) {
  return client.request({ method, params } as never);
}
async function localFixture(payers: LocalAccount[], admin: LocalAccount): Promise<Fixture> {
  const w = wallet(admin);
  async function deploy(name: string, args: unknown[] = []) {
    const a = artifact(name);
    const r = await successful(await w.deployContract({ ...a, args }));
    if (!r.contractAddress) throw new Error(`Missing contract address: ${name}`);
    return r.contractAddress;
  }
  async function write(address: Address, name: string, functionName: string, args: unknown[]) {
    return successful(await w.writeContract({ address, abi: artifact(name).abi, functionName, args }));
  }
  await anvil('evm_setAutomine', [true]);
  for (const p of [admin, ...payers]) await anvil('anvil_setBalance', [p.address, toHex(parseEther('100'))]);
  const asset = await deploy('MockERC3009');
  const accountImpl = await deploy('BondrailAccount');
  const bondImpl = await deploy('BondrailBond');
  const covenant = await deploy('BondrailCovenant', [admin.address, admin.address]);
  const factory = await deploy('BondrailFactory', [covenant, admin.address, bondImpl, accountImpl, admin.address, 0n]);
  await write(covenant, 'BondrailCovenant', 'initializeFactory', [factory]);
  const accounts: Address[] = [];
  for (let i = 0; i <= n; i++) {
    const r = await write(factory, 'BondrailFactory', 'createAccount', [asset]);
    const logs = parseEventLogs({ abi: artifact('BondrailFactory').abi, logs: r.logs, eventName: 'AccountCreated' });
    const account = (logs[0].args as unknown as { account: Address }).account;
    accounts.push(account);
    if (bondMode === 'active') {
      const project = await deploy('MockEarner', [account]);
      await write(account, 'BondrailAccount', 'bindProject', [project]);
      await write(factory, 'BondrailFactory', 'setNativeApproval', [project, true]);
      const now = (await client.getBlock()).timestamp;
      // Cap comfortably exceeds the entire run; all measured payments stay Active.
      const raise = value * BigInt(n * (m + warmups) * 10);
      const terms = {
        raiseAmount: raise, repayCap: raise, stake: 0n, minRevenue: 1n,
        fundingDeadline: now + 3600n, maturity: now + 86400n,
        secondReleaseNotBefore: now + 3600n, secondReleaseDeadline: now + 7200n,
        minOperatingPeriod: 30, revenueBps: 2000, firstReleaseBps: 5000, milestoneMode: 0, minFeeBps: 0,
        triggerWindowDays: 0, stepUpBps: 0, triggerRevenue: 0n,
      };
      await write(factory, 'BondrailFactory', 'createBond', [account, terms,
        { adapter: 0, source: project, policyHash: keccak256(toHex('local parallel benchmark')) }, 'Bench Claim', 'BENCH']);
      const bond = await client.readContract({ address: account, abi: accountAbi, functionName: 'activeBond' });
      await write(asset, 'MockERC3009', 'mint', [admin.address, raise]);
      await write(asset, 'MockERC3009', 'approve', [bond, raise]);
      await write(bond, 'BondrailBond', 'deposit', [raise]);
      await write(factory, 'BondrailFactory', 'activate', [bond]);
    }
  }
  for (const p of payers) await write(asset, 'MockERC3009', 'mint', [p.address, value * BigInt(2 * (m + warmups))]);
  return { asset, sharedAccount: accounts[0], separateAccounts: accounts.slice(1) };
}
async function domainFor(asset: Address): Promise<TypedDataDomain> {
  let domain: TypedDataDomain;
  try {
    const [fields, name, version, id, verifyingContract, salt, extensions] =
      await client.readContract({ address: asset, abi: tokenAbi, functionName: 'eip712Domain' });
    const mask = Number(fields);
    if ((mask & 15) !== 15 || (mask & ~31) !== 0 || extensions.length || id !== BigInt(chain.id)
      || getAddress(verifyingContract) !== getAddress(asset)) throw new Error('Unsupported or mismatched token domain');
    domain = { name, version, chainId: chain.id, verifyingContract, ...(mask & 16 ? { salt } : {}) };
  } catch (error) {
    if (!env.BENCH_TOKEN_NAME || !env.BENCH_TOKEN_VERSION) {
      throw new Error(`Token domain discovery failed (${describe(error)}). Supply BENCH_TOKEN_NAME and BENCH_TOKEN_VERSION.`);
    }
    domain = { name: env.BENCH_TOKEN_NAME, version: env.BENCH_TOKEN_VERSION, chainId: chain.id, verifyingContract: asset };
  }
  // Verify fallback metadata too: a wrong token domain must fail before sending anything.
  const { hashDomain, getTypesForEIP712Domain } = await import('viem');
  const separator = await client.readContract({ address: asset, abi: tokenAbi, functionName: 'DOMAIN_SEPARATOR' });
  if (hashDomain<TypedData>({ domain, types: { EIP712Domain: getTypesForEIP712Domain({ domain }) } }) !== separator) {
    throw new Error('Token DOMAIN_SEPARATOR does not match signing domain');
  }
  return domain;
}
async function prepare(payers: LocalAccount[], destinations: Address[], count: number, domain: TypedDataDomain) {
  const fees = await client.estimateFeesPerGas();
  const now = (await client.getBlock()).timestamp;
  const validBefore = now + BigInt(Math.ceil(timeoutMs / 1000) + 3600);
  return Promise.all(payers.map(async (payer, i) => {
    const w = wallet(payer);
    const [nonce, latest] = await Promise.all([
      client.getTransactionCount({ address: payer.address, blockTag: 'pending' }),
      client.getTransactionCount({ address: payer.address, blockTag: 'latest' }),
    ]);
    if (nonce !== latest) throw new Error(`Payer has pending transactions: ${payer.address}`);
    const signed: Prepared[] = [];
    let gas = 0n;
    for (let j = 0; j < count; j++) {
      const authorization = { from: payer.address, to: destinations[i], value, validAfter: 0n, validBefore,
        nonce: toHex(randomBytes(32)) };
      const signature = parseSignature(await payer.signTypedData({ domain, types, primaryType: 'TransferWithAuthorization', message: authorization }));
      const data = encodeFunctionData({ abi: accountAbi, functionName: 'settle', args: [payer.address, value, 0n,
        validBefore, authorization.nonce, Number(signature.v ?? BigInt(27 + signature.yParity!)), signature.r, signature.s] });
      if (j === 0) gas = (await client.estimateGas({ account: payer, to: destinations[i], data })) * 12n / 10n;
      const raw = await w.signTransaction({ to: destinations[i], data, nonce: nonce + j, gas, ...fees });
      signed.push({ raw, row: { payer: payer.address, account: destinations[i], sequence: j,
        nonce: nonce + j, hash: keccak256(raw), status: 'pending' } });
    }
    const native = await client.getBalance({ address: payer.address });
    if (native < gas * BigInt(count) * fees.maxFeePerGas) throw new Error(`Insufficient gas funding: ${payer.address}`);
    return signed;
  }));
}
async function send(prepared: Prepared[][]) {
  const start = performance.now();
  const pending: Promise<void>[] = [];
  // One independent submission stream per wallet. Await RPC acceptance, never mining, between nonces.
  await Promise.all(prepared.map(async (payments) => {
    let blocked = false;
    for (const { raw, row } of payments) {
      if (blocked) { row.status = 'error'; row.error = 'Skipped after earlier ambiguous broadcast from this payer'; continue; }
      const begin = performance.now();
      row.broadcastAt = new Date().toISOString();
      try {
        await client.sendRawTransaction({ serializedTransaction: raw });
        row.broadcastMs = performance.now() - begin;
        pending.push((async () => {
          try {
            const r = await receipt(row.hash);
            row.latencyMs = performance.now() - begin;
            row.blockNumber = r.blockNumber.toString(); row.transactionIndex = r.transactionIndex;
            row.gasUsed = r.gasUsed.toString(); row.status = r.status;
          } catch (error) { row.status = 'error'; row.error = describe(error); }
        })());
      } catch (error) {
        row.broadcastMs = performance.now() - begin;
        row.status = 'error'; row.error = describe(error); blocked = true;
      }
    }
  }));
  const broadcastWallMs = performance.now() - start;
  await Promise.all(pending);
  return { wallMs: performance.now() - start, broadcastWallMs, transactions: prepared.flat().map(p => p.row) };
}
function percentile(values: number[], p: number) {
  if (!values.length) return null;
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
}
async function summarize(result: Awaited<ReturnType<typeof send>>) {
  const included = result.transactions.filter(r => r.blockNumber !== undefined);
  const numbers = included.map(r => BigInt(r.blockNumber!)).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  const first = numbers[0]; const last = numbers.at(-1);
  const blocks: { number: string; timestamp: string; benchmarkTxs: number; chainTxs: number; gasUsed: string }[] = [];
  // Fetch every block in the range (including empty blocks), without unbounded RPC fan-out.
  if (first !== undefined && last !== undefined) for (let b = first; b <= last; b++) {
    const block = await client.getBlock({ blockNumber: b });
    blocks.push({ number: b.toString(), timestamp: block.timestamp.toString(),
      benchmarkTxs: included.filter(r => r.blockNumber === b.toString()).length,
      chainTxs: block.transactions.length, gasUsed: block.gasUsed.toString() });
  }
  const latencies = included.map(r => r.latencyMs!);
  const gas = included.map(r => Number(r.gasUsed));
  return { ...result, success: result.transactions.filter(r => r.status === 'success').length,
    failed: result.transactions.filter(r => r.status !== 'success').length,
    latencyMs: { min: percentile(latencies, 0), p50: percentile(latencies, .5), p95: percentile(latencies, .95), max: percentile(latencies, 1) },
    gasUsed: { min: percentile(gas, 0), p50: percentile(gas, .5), max: percentile(gas, 1) },
    blockRange: first === undefined ? null : { first: first.toString(), last: last!.toString(), count: blocks.length },
    txsPerBlock: blocks.length ? included.length / blocks.length : null, blocks };
}
async function snapshot(accounts: Address[]) {
  return Promise.all(accounts.map(async address => ({ address,
    revenue: await client.readContract({ address, abi: accountAbi, functionName: 'cumulativeRevenue' }),
    count: await client.readContract({ address, abi: accountAbi, functionName: 'paymentCount' }),
  })));
}
async function main() {
  if (await client.getChainId() !== chain.id) throw new Error(`RPC must use chain ${chain.id}`);
  const clientVersion = await client.request({ method: 'web3_clientVersion' });
  if (mode === 'anvil' && !clientVersion.toLowerCase().includes('anvil')) throw new Error('Local fixture setup requires Anvil');
  const mnemonic = 'test test test test test test test test test test test junk';
  let payers: LocalAccount[];
  let fixture: Fixture;
  if (mode === 'anvil') {
    payers = Array.from({ length: n }, (_, i) => mnemonicToAccount(mnemonic, { addressIndex: i + 1 }));
    fixture = await localFixture(payers, mnemonicToAccount(mnemonic));
  } else {
    if (!env.BENCH_KEYS_FILE || !env.BENCH_FIXTURE_JSON) throw new Error('Monad requires BENCH_KEYS_FILE and BENCH_FIXTURE_JSON');
    const keys: unknown = JSON.parse(fs.readFileSync(env.BENCH_KEYS_FILE, 'utf8'));
    if (!Array.isArray(keys) || keys.length !== n || keys.some(k => typeof k !== 'string' || !/^0x[0-9a-f]{64}$/i.test(k))) {
      throw new Error(`Keys file must contain exactly ${n} private keys as a JSON array`);
    }
    payers = keys.map(k => privateKeyToAccount(k as Hex));
    const f = JSON.parse(fs.readFileSync(env.BENCH_FIXTURE_JSON, 'utf8'));
    fixture = { asset: getAddress(f.asset), sharedAccount: getAddress(f.sharedAccount), separateAccounts: f.separateAccounts.map((a: string) => getAddress(a)) };
  }
  const all = [fixture.sharedAccount, ...fixture.separateAccounts];
  if (fixture.separateAccounts.length !== n || new Set(all.map(a => a.toLowerCase())).size !== n + 1) throw new Error('Need N + 1 distinct accounts');
  if (new Set(payers.map(p => p.address)).size !== n) throw new Error('Payer wallets must be distinct');
  const implementationCode = await client.getCode({ address: all[0] });
  if (!implementationCode || implementationCode === '0x') throw new Error('Account has no deployed code');
  let revenueBps: number | undefined;
  for (const address of all) {
    if (await client.getCode({ address }) !== implementationCode) throw new Error('Accounts must use identical code/clone implementation');
    const asset = await client.readContract({ address, abi: accountAbi, functionName: 'asset' });
    if (getAddress(asset) !== getAddress(fixture.asset)) throw new Error(`Wrong account asset: ${address}`);
    const bond = await client.readContract({ address, abi: accountAbi, functionName: 'activeBond' });
    if (bondMode === 'passthrough' && bond !== zeroAddress) throw new Error('Passthrough fixtures must have no attached bond');
    if (bondMode === 'active') {
      if (bond === zeroAddress || await client.readContract({ address: bond, abi: bondAbi, functionName: 'phase' }) !== 1) {
        throw new Error('Active fixtures must have an Active bond');
      }
      if (await client.readContract({ address: bond, abi: bondAbi, functionName: 'remainingRevenueCap' }) <= value * BigInt(n * (m + warmups))) {
        throw new Error('Bond cap must exceed the run to keep payment costs comparable');
      }
      const bps = await client.readContract({ address: bond, abi: bondAbi, functionName: 'revenueBps' });
      if (revenueBps !== undefined && bps !== revenueBps) throw new Error('Bonds must use the same revenueBps');
      revenueBps = bps;
    }
  }
  for (const p of payers) if (await client.readContract({ address: fixture.asset, abi: tokenAbi, functionName: 'balanceOf', args: [p.address] }) < value * BigInt(2 * (m + warmups))) {
    throw new Error(`Insufficient token funding: ${p.address}`);
  }
  const domain = await domainFor(fixture.asset);
  const destinations = { shared: Array<Address>(n).fill(fixture.sharedAccount), separate: fixture.separateAccounts };
  console.log(`Validated ${n} payers, ${m} payments each, ${mode}, ${bondMode}; preparing untimed warmups.`);
  for (const target of Object.values(destinations)) if (warmups) {
    const result = await send(await prepare(payers, target, warmups, domain));
    if (result.transactions.some(t => t.status !== 'success')) throw new Error('Warmup failed; inspect fixture/RPC before benchmarking');
  }
  const output = path.resolve(root, env.BENCH_OUTPUT_DIR ?? 'docs/bench');
  fs.mkdirSync(output, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(output, `${stamp}-${mode}-${bondMode}`);
  const results: Record<string, Awaited<ReturnType<typeof summarize>>> = {};
  const report = {
    schemaVersion: 1, measuredAt: new Date().toISOString(), chainId: chain.id, clientVersion,
    gitRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    contractSourceDirty: execFileSync('git', ['status', '--porcelain', '--', 'contracts/src'], { cwd: root, encoding: 'utf8' }).trim() !== '',
    note: mode === 'anvil' ? 'Script validation only. Anvil does not execute transactions in parallel.' : 'RPC-observed inclusion latency; not a direct measurement of executor conflicts.',
    config: { wallets: n, payments: m, warmups, amount: value.toString(), order, bondMode, pollMs, timeoutMs, localBlockSeconds: mode === 'anvil' ? blockSeconds : null },
    accountCodeHash: keccak256(implementationCode), revenueBps: revenueBps ?? null,
    status: 'in_progress', error: null as string | null,
    fixture, payers: payers.map(p => p.address), results,
  };
  const save = () => fs.writeFileSync(`${file}.json`, JSON.stringify(report, null, 2) + '\n');
  const arms = order === 'shared-first' ? ['shared', 'separate'] as const : ['separate', 'shared'] as const;
  try {
    if (mode === 'anvil') { await anvil('evm_setAutomine', [false]); await anvil('evm_setIntervalMining', [blockSeconds]); }
    for (const arm of arms) {
      const accounts = [...new Set(destinations[arm])];
      const prepared = await prepare(payers, destinations[arm], m, domain);
      const before = await snapshot(accounts);
      const result = await send(prepared);
      // Preserve all hashes/statuses even if later block reads or accounting assertions fail.
      fs.writeFileSync(`${file}-${arm}-transactions.json`, JSON.stringify(result, null, 2) + '\n');
      results[arm] = await summarize(result);
      save();
      const after = await snapshot(accounts);
      for (let i = 0; i < accounts.length; i++) {
        const count = BigInt(result.transactions.filter(t => t.account === accounts[i] && t.status === 'success').length);
        if (after[i].count - before[i].count !== count || after[i].revenue - before[i].revenue !== count * value) {
          throw new Error(`Accounting delta mismatch for ${accounts[i]} (use isolated fixtures)`);
        }
      }
      console.log(`${arm}: ${results[arm].success}/${n * m} succeeded, ${result.wallMs.toFixed(1)} ms`);
      if (results[arm].failed) throw new Error(`${arm} has failed/unknown transactions; hashes saved; do not treat as a valid comparison`);
    }
    report.status = 'complete';
  } catch (error) {
    report.status = 'failed'; report.error = describe(error);
    throw error;
  } finally {
    if (mode === 'anvil') { await anvil('evm_setIntervalMining', [0]); await anvil('evm_setAutomine', [true]); }
    save();
    const fmt = (v: number | null | undefined) => v == null ? 'n/a' : v.toFixed(2);
    const table = '| Arm | Success / sent | Wall ms | Broadcast ms | Latency p50 / p95 ms | Txs / block | Block range | Gas p50 |\n|---|---:|---:|---:|---:|---:|---|---:|\n' +
      Object.entries(results).map(([arm, r]) => `| ${arm} | ${r.success} / ${r.transactions.length} | ${fmt(r.wallMs)} | ${fmt(r.broadcastWallMs)} | ${fmt(r.latencyMs.p50)} / ${fmt(r.latencyMs.p95)} | ${fmt(r.txsPerBlock)} | ${r.blockRange ? `${r.blockRange.first}–${r.blockRange.last}` : 'n/a'} | ${r.gasUsed.p50 ?? 'n/a'} |`).join('\n');
    fs.writeFileSync(`${file}.md`, `# Payment load: ${mode}, ${bondMode}\n\n${report.note}\n\nStatus: ${report.status}${report.error ? ` (${report.error})` : ''}.\n\n${n} wallets × ${m} payments per arm; ${warmups} untimed warmups per wallet per arm. Order: ${order}. Receipt polling: ${pollMs} ms.\n\n${table}\n\nRaw data: [JSON](./${path.basename(file)}.json). Failed or incomplete arms invalidate comparison.\n`);
    if (report.status === 'complete') for (const arm of arms) fs.unlinkSync(`${file}-${arm}-transactions.json`);
    console.log(`Results: ${path.relative(root, file)}.{json,md}`);
  }
}
main().catch(error => { console.error(describe(error)); process.exitCode = 1; });
