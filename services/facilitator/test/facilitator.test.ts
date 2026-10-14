import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BaseError, ContractFunctionRevertedError, ContractFunctionZeroDataError, zeroHash, type Address, type Hex, type TypedDataDomain } from 'viem';
import type { AddressInfo } from 'node:net';
import { privateKeyToAccount } from 'viem/accounts';
import { monadTestnet } from 'viem/chains';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import { exactUsdcRequirements, httpFacilitator } from '@bondrail/sdk/x402';
import { authorizationTypes, createFacilitator, type FacilitatorOptions } from '../src/index.js';
import { facilitatorServer } from '../src/http.js';

const payer = privateKeyToAccount(`0x${'01'.repeat(32)}`);
const gasPayer = privateKeyToAccount(`0x${'02'.repeat(32)}`);
const asset = '0x1111111111111111111111111111111111111111';
const account = '0x2222222222222222222222222222222222222222';
const factory = '0x3333333333333333333333333333333333333333';
const tx = `0x${'ab'.repeat(32)}` as const;
const now = 1_800_000_000;

async function setup(options: {
  chainId?: number;
  walletChainId?: number;
  tokenDomain?: TypedDataDomain;
  domainError?: Error;
  getterError?: Error;
  fields?: Hex;
  extensions?: bigint[];
  overrides?: Pick<FacilitatorOptions, 'domainName' | 'domainVersion'>;
} = {}) {
  const chainId = options.chainId ?? 10143;
  const tokenDomain = { name: 'USDC', version: '2', chainId, verifyingContract: asset, ...options.tokenDomain } satisfies TypedDataDomain;
  const domain = { ...tokenDomain, name: options.overrides?.domainName ?? tokenDomain.name,
    version: options.overrides?.domainVersion ?? tokenDomain.version };
  const requirements = exactUsdcRequirements({ chainId, asset, amount: '10000', payTo: account });
  requirements.extra.name = domain.name;
  requirements.extra.version = domain.version;
  const authorization = { from: payer.address, to: account as Address, value: '10000', validAfter: String(now - 1), validBefore: String(now + 300), nonce: `0x${'12'.repeat(32)}` as const };
  const sign = (signedDomain: TypedDataDomain = domain) => payer.signTypedData({
    domain: signedDomain, types: authorizationTypes, primaryType: 'TransferWithAuthorization',
    message: { ...authorization, value: BigInt(authorization.value), validAfter: BigInt(authorization.validAfter), validBefore: BigInt(authorization.validBefore) },
  });
  const payload: PaymentPayload = { x402Version: 2, accepted: structuredClone(requirements), payload: { authorization, signature: await sign() } };
  const state = { isAccount: true, accountAsset: asset, used: false, balance: 10000n, chainReads: 0, reads: [] as string[],
    simulationFails: false, receiptStatus: 'success', timeout: false, blockTime: BigInt(now), writes: [] as any[], simulations: [] as any[] };
  const publicClient = {
    getChainId: async () => { state.chainReads++; return chainId; },
    getBlock: async () => ({ timestamp: state.blockTime }),
    readContract: async ({ address, functionName }: { address: Address; functionName: string }) => {
      state.reads.push(functionName);
      if (['eip712Domain', 'name', 'version'].includes(functionName)) assert.equal(address, asset);
      if (functionName === 'eip712Domain') {
        if (options.domainError) throw options.domainError;
        return [options.fields ?? (tokenDomain.salt ? '0x1f' : '0x0f'), tokenDomain.name, tokenDomain.version,
          BigInt(tokenDomain.chainId), tokenDomain.verifyingContract, tokenDomain.salt ?? zeroHash, options.extensions ?? []];
      }
      if (functionName === 'name' || functionName === 'version') {
        if (options.getterError) throw options.getterError;
        return tokenDomain[functionName];
      }
      if (functionName === 'isAccount') return state.isAccount;
      if (functionName === 'asset') return state.accountAsset;
      if (functionName === 'authorizationState') return state.used;
      if (functionName === 'balanceOf') return state.balance;
      throw new Error('unexpected read');
    },
    simulateContract: async (request: unknown) => {
      state.simulations.push(request);
      if (state.simulationFails) throw new Error('execution reverted');
      return { request };
    },
    waitForTransactionReceipt: async ({ hash }: { hash: string }) => {
      assert.equal(hash, tx);
      if (state.timeout) throw new Error('timeout waiting for receipt');
      return { status: state.receiptStatus };
    },
  } as unknown as FacilitatorOptions['publicClient'];
  const walletClient = { account: gasPayer, chain: { ...monadTestnet, id: options.walletChainId ?? chainId },
    writeContract: async (request: unknown) => { state.writes.push(request); state.used = true; return tx; },
  } as unknown as Exclude<FacilitatorOptions['walletClient'], Function>;
  const service = await createFacilitator({ factory, asset, publicClient, ...options.overrides,
    walletClient: discoveredChainId => { assert.equal(discoveredChainId, chainId); return walletClient; }, now: () => now });
  return { service, state, payload, requirements, authorization, sign };
}

test('valid signature verifies without a write and settles via the account after simulation', async () => {
  const f = await setup();
  assert.deepEqual(await f.service.verify(f.payload, f.requirements), { isValid: true, payer: payer.address });
  assert.equal(f.state.writes.length, 0);
  assert.deepEqual(await f.service.settle(f.payload, f.requirements), {
    success: true, transaction: tx, network: 'eip155:10143', payer: payer.address, amount: '10000',
  });
  assert.equal(f.state.writes.length, 1);
  assert.equal(f.state.writes[0].address, account);
  assert.equal(f.state.writes[0].functionName, 'settle');
  assert.deepEqual(f.state.writes[0].args.slice(0, 5), [payer.address, 10000n, BigInt(now - 1), BigInt(now + 300), f.authorization.nonce]);
  assert.equal(f.state.simulations.length, 2);
});

test('discovers and caches ERC-5267 domain and mainnet chain before serving payments', async () => {
  const f = await setup({ chainId: 143, tokenDomain: { name: 'Mainnet Dollar', version: '7' },
    getterError: new Error('ERC-20 getters must not be used when ERC-5267 succeeds') });
  assert.equal(f.state.chainReads, 1);
  assert.deepEqual(f.state.reads, ['eip712Domain']);
  assert.deepEqual(f.service.supported(), {
    kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:143', extra: { assetTransferMethod: 'eip3009' } }],
    extensions: [], signers: { 'eip155:143': [gasPayer.address] },
  });
  assert.equal((await f.service.verify(f.payload, f.requirements)).isValid, true);
  const result = await f.service.settle(f.payload, f.requirements);
  assert.equal(result.success, true);
  assert.equal(result.network, 'eip155:143');
  assert.equal(f.state.chainReads, 1);
  assert.deepEqual(f.state.reads.filter(name => ['eip712Domain', 'name', 'version'].includes(name)), ['eip712Domain']);
});

const domainRevert = () => new BaseError('Contract call failed', { cause:
  new ContractFunctionRevertedError({ abi: [], functionName: 'eip712Domain' }) });

for (const [label, domainError] of [
  ['reverts', domainRevert()],
  ['returns no data', new ContractFunctionZeroDataError({ functionName: 'eip712Domain' })],
] as const) {
  test(`falls back to name()/version() when eip712Domain ${label}`, async () => {
    const f = await setup({ chainId: 1, tokenDomain: { name: 'USD Coin', version: '3' }, domainError });
    assert.deepEqual(f.state.reads, ['eip712Domain', 'name', 'version']);
    assert.equal((await f.service.verify(f.payload, f.requirements)).isValid, true);
    assert.equal((await f.service.settle(f.payload, f.requirements)).success, true);
    assert.equal(f.state.chainReads, 1);
    assert.equal(f.state.reads.filter(name => name === 'name' || name === 'version').length, 2);
  });
}

test('uses the optional ERC-5267 salt in signature verification', async () => {
  const f = await setup({ tokenDomain: { salt: `0x${'aa'.repeat(32)}` } });
  assert.equal((await f.service.verify(f.payload, f.requirements)).isValid, true);
  f.payload.payload.signature = await f.sign({ name: 'USDC', version: '2', chainId: 10143, verifyingContract: asset });
  assert.equal((await f.service.verify(f.payload, f.requirements)).invalidReason, 'invalid_signature');
});

for (const source of ['ERC-5267', 'fallback'] as const) {
  test(`name/version overrides take precedence over ${source} discovery`, async () => {
    const f = await setup({ domainError: source === 'fallback' ? domainRevert() : undefined,
      getterError: new Error('overridden getters must not be called'),
      overrides: { domainName: 'Configured Dollar', domainVersion: '9' } });
    assert.deepEqual(f.state.reads, ['eip712Domain']);
    assert.equal((await f.service.verify(f.payload, f.requirements)).isValid, true);
    f.payload.payload.signature = await f.sign({ name: 'USDC', version: '2', chainId: 10143, verifyingContract: asset });
    assert.equal((await f.service.verify(f.payload, f.requirements)).invalidReason, 'invalid_signature');
  });
}

test('a single override still discovers the other fallback field', async () => {
  for (const overrides of [{ domainName: 'Custom Dollar' }, { domainVersion: '8' }]) {
    const f = await setup({ domainError: domainRevert(), overrides });
    assert.deepEqual(f.state.reads, ['eip712Domain', overrides.domainName ? 'version' : 'name']);
    assert.equal((await f.service.verify(f.payload, f.requirements)).isValid, true);
  }
});

test('fails startup on RPC/wallet mismatch, invalid domain metadata or unavailable discovery', async () => {
  await assert.rejects(setup({ walletChainId: 1 }), /rpc_chain_mismatch/);
  await assert.rejects(setup({ tokenDomain: { chainId: 1 } }), /token_domain_mismatch/);
  await assert.rejects(setup({ tokenDomain: { verifyingContract: factory } }), /token_domain_mismatch/);
  await assert.rejects(setup({ fields: '0x0b' }), /unsupported_token_domain/);
  await assert.rejects(setup({ fields: '0x2f' }), /unsupported_token_domain/);
  await assert.rejects(setup({ extensions: [123n] }), /unsupported_token_domain/);
  await assert.rejects(setup({ domainError: domainRevert(), getterError: new Error('getter unavailable') }), /getter unavailable/);
  await assert.rejects(setup({ domainError: new Error('RPC unavailable'),
    overrides: { domainName: 'USDC', domainVersion: '2' } }), /RPC unavailable/);
});

test('rejects mismatched offer networks and a signature for another chain before simulation', async () => {
  for (const mismatch of ['requirements', 'accepted', 'both', 'signature'] as const) {
    const f = await setup({ chainId: 143 });
    if (mismatch === 'requirements' || mismatch === 'both') f.requirements.network = 'eip155:10143';
    if (mismatch === 'accepted' || mismatch === 'both') f.payload.accepted.network = 'eip155:10143';
    if (mismatch === 'signature') f.payload.payload.signature = await f.sign({
      name: 'USDC', version: '2', chainId: 10143, verifyingContract: asset,
    });
    const reason = mismatch === 'signature' ? 'invalid_signature' : 'unsupported_requirements';
    assert.equal((await f.service.verify(f.payload, f.requirements)).invalidReason, reason);
    const result = await f.service.settle(f.payload, f.requirements);
    assert.equal(result.success, false);
    assert.equal(result.errorReason, reason);
    assert.equal(result.network, 'eip155:143');
    assert.equal(f.state.simulations.length, 0);
    assert.equal(f.state.writes.length, 0);
  }
});

type Fixture = Awaited<ReturnType<typeof setup>>;
const rejects: [string, (f: Fixture) => void | Promise<void>][] = [
  ['wrong signature', f => { f.payload.payload.signature = `0x${'01'.repeat(64)}1b`; }],
  ['wrong signed domain', async f => { f.payload.payload.signature = await f.sign({ name: 'FAKE', version: '2', chainId: 10143, verifyingContract: asset }); }],
  ['wrong network', f => { f.requirements.network = 'eip155:1'; }],
  ['wrong scheme', f => { f.requirements.scheme = 'upto'; }],
  ['wrong asset', f => { f.requirements.asset = factory; }],
  ['wrong payTo', f => { f.requirements.payTo = factory; }],
  ['wrong amount', f => { f.authorization.value = '10001'; }],
  ['zero amount', f => { f.requirements.amount = f.payload.accepted.amount = f.authorization.value = '0'; }],
  ['zero payer', f => { f.authorization.from = `0x${'00'.repeat(20)}`; }],
  ['self payer', f => { f.authorization.from = account; }],
  ['malformed nonce', f => { f.payload.payload.authorization = { ...f.authorization, nonce: '0x12' }; }],
  ['malformed uint', f => { f.authorization.value = '-1'; }],
  ['overflowing uint', f => { f.authorization.validBefore = String(2n ** 256n); }],
  ['expired', f => { f.authorization.validBefore = String(now); }],
  ['not yet valid at strict boundary', f => { f.authorization.validAfter = String(now); }],
  ['overlong authorization', f => { f.authorization.validBefore = String(now + 301); }],
  ['offer domain mismatch', f => { f.requirements.extra.name = 'FAKE'; }],
  ['offer version mismatch', f => { f.requirements.extra.version = '3'; }],
  ['accepted domain mismatch', f => { f.payload.accepted.extra.name = 'FAKE'; }],
  ['accepted version mismatch', f => { f.payload.accepted.extra.version = '3'; }],
  ['accepted requirements mismatch', f => { f.payload.accepted.amount = '123'; }],
  ['non-Slice recipient', f => { f.state.isAccount = false; }],
  ['account asset mismatch', f => { f.state.accountAsset = factory; }],
  ['already consumed authorization', f => { f.state.used = true; }],
  ['insufficient payer funds', f => { f.state.balance = 9999n; }],
  ['chain timestamp past expiry', f => { f.state.blockTime = BigInt(now + 301); }],
  ['reverting simulation or old implementation', f => { f.state.simulationFails = true; }],
  ['malformed payload', f => { f.payload.payload = null as never; }],
];
for (const [name, mutate] of rejects) {
  test(`refuses ${name} before submitting`, async () => {
    const f = await setup();
    await mutate(f);
    assert.equal((await f.service.verify(f.payload, f.requirements)).isValid, false);
    assert.equal((await f.service.settle(f.payload, f.requirements)).success, false);
    assert.equal(f.state.writes.length, 0);
  });
}

test('concurrent replay submits once, then rechecks nonce before the next write', async () => {
  const f = await setup();
  const responses = await Promise.all([f.service.settle(f.payload, f.requirements), f.service.settle(f.payload, f.requirements)]);
  assert.equal(responses.filter(r => r.success).length, 1);
  assert.equal(responses[1].errorReason, 'authorization_used');
  assert.equal(f.state.writes.length, 1);
});

test('receipt timeout retains broadcast hash; reverted receipts never report success', async () => {
  for (const timeout of [false, true]) {
    const f = await setup();
    f.state.timeout = timeout;
    f.state.receiptStatus = 'reverted';
    const result = await f.service.settle(f.payload, f.requirements);
    assert.equal(result.success, false);
    assert.equal(result.transaction, tx);
    assert.equal(result.errorReason, timeout ? 'settlement_pending' : 'settlement_reverted');
  }
});

test('x402 resource server used by the agent discovers, verifies and settles over HTTP', async t => {
  const f = await setup();
  const server = facilitatorServer(f.service);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const client = httpFacilitator(url, 10143);
  assert.equal((await client.verify(f.payload, f.requirements)).isValid, true);
  const result = await client.settle(f.payload, f.requirements);
  assert.equal(result.success, true);
  assert.equal(result.transaction, tx);
  assert.equal((await fetch(`${url}/verify`, { method: 'POST', body: '{' })).status, 400);
  assert.equal((await fetch(`${url}/settle`, { method: 'POST', body: 'x'.repeat(17000) })).status, 413);
  assert.equal((await fetch(`${url}/unknown`)).status, 404);
});
