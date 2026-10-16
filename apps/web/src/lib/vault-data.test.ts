import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allocationHeadroom, depositGap, isTeamVault, realizedVaultHistory, vaultAmount, vaultInputError, type VaultSnapshot } from './vault-data';
test('realized history skips unpriced days, keeps zero prices and scales raw shares using token decimals', () => {
  const row = (day: number, realizedPrice: string | null): VaultSnapshot => ({ id: String(day), vault: '0xABC', day,
    timestamp: '1', block: '1', totalSupply: '0', realizedPrice, realizedPriceKind: 'Deposit', realizedPriceTimestamp: '1' });
  const rows = [row(5, '0'), row(2, '1234567000000'), row(3, null), { ...row(1, '9000000000000'), vault: '0xdef' }];
  const points = realizedVaultHistory(rows, { address: '0xabc', decimals: 12, assetDecimals: 6 });
  assert.deepEqual(points.map(p => [p.day, p.price]), [[2, '1.234567'], [5, '0']]);
  assert.equal(realizedVaultHistory([row(1, '1500000000000')], { address: '0xabc', decimals: 24, assetDecimals: 18 })[0].price, '1.5');
});
const p = { nav: 1000n, idle: 500n, holdingValue: 100n, cap: 2500n, buffer: 2000n, holdings: 1, maxBonds: 16n, tracked: true, raiseRemaining: 1000n };
test('team origin requires the registered original and manifest operator owner, never a name', () => {
  const original = { address: '0xAbC', owner: '0xDeF' };
  const deployment = { vault: '0xabc', operator: '0xdef', vaultFactory: '0x123' };
  assert.equal(isTeamVault(original, deployment), true);
  assert.equal(isTeamVault({ ...original, owner: '0x456' }, deployment), false);
  assert.equal(isTeamVault({ ...original, address: '0x789' }, deployment), false);
  assert.equal(isTeamVault(original, { ...deployment, operator: undefined }), false);
  assert.equal(isTeamVault(original, { ...deployment, vaultFactory: undefined }), false);
});
test('immediate exit loss uses asset units with an exact greater-than-2% acknowledgement threshold', () => {
  assert.deepEqual(depositGap(100_000n, 87_504n), { exitAssets: 87_504n, percent: '12.5', requiresAcknowledgement: true });
  assert.equal(depositGap(100_000n, 98_001n)?.requiresAcknowledgement, false);
  assert.equal(depositGap(100_000n, 98_000n)?.requiresAcknowledgement, false);
  assert.deepEqual(depositGap(100_000n, 97_999n), { exitAssets: 97_999n, percent: '2.01', requiresAcknowledgement: true });
  assert.equal(depositGap(10n ** 30n, 98n * 10n ** 28n - 1n)?.requiresAcknowledgement, true);
  assert.equal(depositGap(100n, 0n)?.percent, '100');
  assert.equal(depositGap(100n, 100n), undefined);
  assert.equal(depositGap(100n, 101n), undefined);
  assert.equal(depositGap(0n, 0n), undefined);
});
test('headroom respects concentration, idle ceil, holding slots and remaining raise', () => {
  assert.deepEqual(allocationHeadroom(p), { available: 150n, concentration: 150n, liquidity: 300n, bufferRequired: 200n, slotAvailable: true });
  assert.equal(allocationHeadroom({ ...p, idle: 230n }).available, 30n);
  assert.equal(allocationHeadroom({ ...p, raiseRemaining: 40n }).available, 40n);
  assert.equal(allocationHeadroom({ ...p, nav: 1001n }).bufferRequired, 201n);
  assert.equal(allocationHeadroom({ ...p, holdings: 16, tracked: false }).available, 0n);
  assert.equal(allocationHeadroom({ ...p, holdings: 16 }).available, 150n);
  assert.equal(allocationHeadroom({ ...p, idle: 0n }).available, 0n);
  assert.equal(allocationHeadroom({ ...p, holdingValue: 400n }).available, 0n);
});
test('headroom respects stricter input limits without changing on-chain hard maxima', () => {
  assert.equal(allocationHeadroom({ ...p, cap: 1500n }).available, 50n);
  assert.equal(allocationHeadroom({ ...p, buffer: 4800n }).available, 20n);
  assert.equal(allocationHeadroom({ ...p, maxBonds: 1n, tracked: false }).available, 0n);
});
test('amount parsing rejects silent decimal rounding, negative amounts and scientific notation', () => {
  assert.equal(vaultAmount('1.000001', 6), 1_000_001n);
  for (const text of ['1.0000001', '-1', '1e6', '', 'NaN', '.']) assert.equal(vaultAmount(text, 6), undefined);
  assert.equal(vaultAmount('1.000000000001', 12), 1_000_000_000_001n);
});
test('transaction error states fail closed for wallet, network, failed reads, zero-share, limits and balance', () => {
  const good = { connected: true, correctNetwork: true, amount: 100n, balance: 200n, preview: 100n, max: 200n, deposit: true };
  assert.equal(vaultInputError(good), undefined);
  assert.match(vaultInputError({ ...good, connected: false })!, /Connect/);
  assert.match(vaultInputError({ ...good, correctNetwork: false })!, /Switch/);
  assert.match(vaultInputError({ ...good, closed: true })!, /Closed.*zero deposit limit/);
  assert.match(vaultInputError({ ...good, readError: true })!, /Could not refresh/);
  assert.match(vaultInputError({ ...good, preview: 0n })!, /zero shares/);
  assert.match(vaultInputError({ ...good, amount: 201n })!, /Insufficient/);
  assert.match(vaultInputError({ ...good, deposit: false, max: 99n })!, /rest is invested/);
  assert.match(vaultInputError({ ...good, balance: undefined })!, /Reading/);
  assert.match(vaultInputError({ ...good, amount: undefined })!, /valid amount/);
});
