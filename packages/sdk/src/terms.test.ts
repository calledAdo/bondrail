import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeAbiParameters, encodeFunctionResult, parseAbiParameters, type PublicClient } from 'viem';
import { sliceBondAbi } from './abis';
import { readBondTerms } from './client';

const address = '0x1111111111111111111111111111111111111111';
const base = { raiseAmount: 100n, repayCap: 120n, stake: 0n, minRevenue: 10n, fundingDeadline: 1n,
  maturity: 1000n, secondReleaseNotBefore: 10n, secondReleaseDeadline: 500n,
  minOperatingPeriod: 30, revenueBps: 2500, firstReleaseBps: 5000, milestoneMode: 0, minFeeBps: 0 };
const mock = (data: `0x${string}` | undefined): Pick<PublicClient, 'call'> => ({ call: async () => ({ data }) });

test('reads both immutable bond term versions without losing original listings', async () => {
  const legacy = encodeAbiParameters(parseAbiParameters('uint256[13]'), [
    [100n, 120n, 0n, 10n, 1n, 1000n, 10n, 500n, 30n, 2500n, 5000n, 0n, 0n],
  ]);
  assert.deepEqual(await readBondTerms(mock(legacy), address),
    { ...base, triggerWindowDays: 0, stepUpBps: 0, triggerRevenue: 0n });
  const terms = { ...base, triggerWindowDays: 2, stepUpBps: 4000, triggerRevenue: 10n };
  const data = encodeFunctionResult({ abi: sliceBondAbi, functionName: 'terms', result: terms });
  assert.deepEqual(await readBondTerms(mock(data), address), terms);
});

test('malformed terms and RPC errors are not misrepresented as disabled triggers', async () => {
  await assert.rejects(readBondTerms(mock(undefined), address));
  await assert.rejects(readBondTerms(mock('0x01'), address));
  await assert.rejects(readBondTerms({ call: async () => { throw new Error('RPC unavailable'); } }, address), /RPC unavailable/);
});
