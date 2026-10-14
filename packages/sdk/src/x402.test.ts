import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Account, Chain, Hex, Transport, WalletClient } from 'viem';
import { settleThroughAccount, type TransferAuthorization } from './x402';

const account = '0x1111111111111111111111111111111111111111';
const authorization: TransferAuthorization = {
  from: '0x2222222222222222222222222222222222222222', to: account,
  value: '10000', validAfter: '1', validBefore: '2000000000', nonce: `0x${'ab'.repeat(32)}`,
};
const r = '01'.repeat(32), s = '02'.repeat(32);

for (const [suffix, v] of [['1b', 27], ['1c', 28], ['00', 27], ['01', 28]] as const) {
  test(`settleThroughAccount splits r/s and normalizes signature v=${suffix}`, async () => {
    let request: any;
    const hash: Hex = `0x${'12'.repeat(32)}`;
    const wallet = { writeContract: async (r: unknown) => { request = r; return hash; } } as unknown as WalletClient<Transport, Chain, Account>;
    assert.equal(await settleThroughAccount(wallet, account, authorization, `0x${r}${s}${suffix}`), hash);
    assert.equal(request.address, account);
    assert.equal(request.functionName, 'settle');
    assert.deepEqual(request.args, [authorization.from, 10000n, 1n, 2000000000n, authorization.nonce, v, `0x${r}`, `0x${s}`]);
  });
}

test('settleThroughAccount rejects a different recipient or malformed signature before writing', async () => {
  const wallet = { writeContract: () => assert.fail('must not submit') } as unknown as WalletClient<Transport, Chain, Account>;
  await assert.rejects(settleThroughAccount(wallet, account, { ...authorization, to: authorization.from }, `0x${r}${s}1b`), /recipient/);
  await assert.rejects(settleThroughAccount(wallet, account, authorization, '0x12'), /65-byte/);
  await assert.rejects(settleThroughAccount(wallet, account, authorization, `0x${r}${s}ff`));
});
