import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aggregateLiveStats, type LiveIndexerData } from './live-stats';

// Read-only snapshot of deployment 10143's public Envio response on 2026-10-15.
const { data } = JSON.parse(readFileSync(new URL('./fixtures/live-indexer.json', import.meta.url), 'utf8')) as { data: LiveIndexerData };
const asset = '0x534b2f3A21130d7a60830c2Df862319e593943A3';

test('live indexer aggregation preserves base units, all payments, and Active/Closing counts', () => {
  const stats = aggregateLiveStats(data, asset);
  assert.equal(stats.revenue, 0.464494);
  assert.equal(stats.toInvestors, 0.0775);
  assert.equal(stats.payments, 58);
  assert.equal(stats.activeBonds, 2);
  assert.equal(stats.accounts, 3);
  assert.equal(stats.recent[0].amount, 0.01);
  assert.equal(stats.recent[0].timestamp, 1792102094);
});

test('other assets and unknown accounts never become dollar amounts; profiles do not filter totals', () => {
  const other = { ...data.Issuer[0], id: 'other', asset: 'other-asset', grossRevenue: '999000000000000000000', payments: 7 };
  const stats = aggregateLiveStats({
    ...data, Issuer: [...data.Issuer, other],
    Bond: [...data.Bond, { phase: 2 }, { phase: 3 }, { phase: 4 }],
    Payment: [...data.Payment, { ...data.Payment[0], account: 'other' }, { ...data.Payment[0], account: 'unknown' }],
  }, asset.toUpperCase());
  assert.equal(stats.revenue, 0.464494);
  assert.equal(stats.toInvestors, 0.0775);
  assert.equal(stats.payments, 65);
  assert.equal(stats.activeBonds, 3);
  assert.equal(stats.recent.length, data.Payment.length);
  assert.throws(() => aggregateLiveStats(data, ''), /not configured/);
  assert.equal(aggregateLiveStats({ Issuer: [], Bond: [], Payment: [] }, asset).revenue, 0);
});
