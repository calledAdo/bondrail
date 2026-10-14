import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Address, Hex } from 'viem';
import type { CreditAttestation } from '@bondrail/sdk/credit';
import { relayAttestation } from '../src/relay.ts';

const registry: Address = '0x1111111111111111111111111111111111111111';
const account: Address = '0x2222222222222222222222222222222222222222';
const factory: Address = '0x3333333333333333333333333333333333333333';
const signer: Address = '0x4444444444444444444444444444444444444444';
const first: Address = '0x5555555555555555555555555555555555555555';
const second: Address = '0x6666666666666666666666666666666666666666';
const attestation = { account } as CreditAttestation;
type Request = { address: Address; functionName: string; args?: readonly unknown[]; blockNumber?: bigint };

function harness(options: { created?: bigint; registered?: Address[]; missingEvent?: boolean; reverted?: boolean; newBond?: boolean; wrongSigner?: boolean } = {}) {
  const created = options.created ?? 2n;
  const registered = new Set(options.registered ?? [first]);
  const sequence: string[] = [];
  const scans: { address: Address; args: { account: Address }; fromBlock: bigint; toBlock: bigint }[] = [];
  const pending = new Map<Hex, Request>();
  let profileReads = 0;
  const client = {
    getBlockNumber: async () => 10_001n,
    readContract: async (request: Request) => {
      assert.equal(request.address, registry);
      switch (request.functionName) {
        case 'attester': return options.wrongSigner ? account : signer;
        case 'factory': return factory;
        case 'MAX_BONDS': return 64n;
        case 'recorded': return registered.has(request.args![0] as Address);
        case 'onchainProfile': {
          assert.deepEqual(request.args, [account]);
          if (++profileReads === 1) assert.equal(request.blockNumber, 10_001n);
          else assert.equal(request.blockNumber, undefined);
          const bondsCreated = created + (options.newBond && profileReads > 1 ? 1n : 0n);
          return { bondsCreated, complete: BigInt(registered.size) === bondsCreated };
        }
        default: throw new Error(`Unexpected read ${request.functionName}`);
      }
    },
    getContractEvents: async (request: typeof scans[number]) => {
      scans.push(request);
      return (request.fromBlock === 0n ? [first] : options.missingEvent ? [] : [second]).map(bond => ({ args: { bond } }));
    },
    simulateContract: async (request: Request) => {
      sequence.push(`simulate:${request.functionName}`);
      return { request };
    },
    waitForTransactionReceipt: async ({ hash }: { hash: Hex }) => {
      const request = pending.get(hash)!;
      sequence.push(`confirm:${request.functionName}`);
      if (options.reverted) return { status: 'reverted' };
      if (request.functionName === 'recordBond') registered.add(request.args![0] as Address);
      return { status: 'success' };
    },
  } as unknown as Parameters<typeof relayAttestation>[0];
  const wallet = {
    account: { address: signer },
    writeContract: async (request: Request) => {
      sequence.push(`send:${request.functionName}`);
      const hash = `0x${(pending.size + 1).toString(16).padStart(64, '0')}` as Hex;
      pending.set(hash, request);
      return hash;
    },
  } as unknown as Parameters<typeof relayAttestation>[1];
  return { run: () => relayAttestation(client, wallet, registry, attestation, '0x01'), sequence, scans, registered };
}

test('relay scans all factory pages and confirms missing bonds before attesting', async () => {
  const h = harness();
  const result = await h.run();
  assert.equal(result.recordedHashes.length, 1);
  assert.ok(h.registered.has(second));
  assert.deepEqual(h.scans.map(s => [s.address, s.args, s.fromBlock, s.toBlock]), [
    [factory, { account }, 0n, 9_999n], [factory, { account }, 10_000n, 10_001n],
  ]);
  assert.deepEqual(h.sequence, ['simulate:recordBond', 'send:recordBond', 'confirm:recordBond', 'simulate:attest', 'send:attest', 'confirm:attest']);
});

test('relay skips registration when all or zero bonds are already recorded', async () => {
  for (const options of [{ registered: [first, second] }, { created: 0n, registered: [] }]) {
    const h = harness(options);
    assert.deepEqual((await h.run()).recordedHashes, []);
    assert.equal(h.scans.length, 0);
    assert.deepEqual(h.sequence, ['simulate:attest', 'send:attest', 'confirm:attest']);
  }
});

test('missing factory events prevent registration and attestation', async () => {
  const h = harness({ missingEvent: true });
  await assert.rejects(h.run(), /do not reconcile/);
  assert.deepEqual(h.sequence, []);
});

test('accounts over the registry limit are not attested', async () => {
  const h = harness({ created: 65n });
  await assert.rejects(h.run(), /bond limit/);
  assert.deepEqual(h.sequence, []);
  assert.equal(h.scans.length, 0);
});

test('failed registration receipt prevents attestation', async () => {
  const h = harness({ reverted: true });
  await assert.rejects(h.run(), /Record bond reverted/);
  assert.deepEqual(h.sequence, ['simulate:recordBond', 'send:recordBond', 'confirm:recordBond']);
});

test('new issuance during backfill prevents attestation until a retry completes coverage', async () => {
  const h = harness({ newBond: true });
  await assert.rejects(h.run(), /still incomplete/);
  assert.ok(h.registered.has(second));
  assert.ok(h.sequence.every(s => !s.endsWith(':attest')));
});

test('a rotated-out signing key cannot submit backfill or attestation', async () => {
  const h = harness({ wrongSigner: true });
  await assert.rejects(h.run(), /not the registry attester/);
  assert.deepEqual(h.sequence, []);
  assert.equal(h.scans.length, 0);
});
