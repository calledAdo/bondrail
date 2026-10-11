import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexedScore } from './envio.ts';

// Rows exactly as the indexer writes them: a Native pull, an x402 settlement, and an unclassified transfer.
const row = (id: string, source: string, amount: string, related: boolean, reasons: string[] = []) => ({
  id, chainId: 10143, account: '0xacc', payer: `0xpayer${id}`, amount, timestamp: '1791600000',
  source, synthetic: false, related, evidenceComplete: true, reasons,
});
const indexer = (rows: unknown[]) =>
  (async () => Response.json({ data: { Payment: rows } })) as unknown as typeof fetch;
const window = { chainId: 10143, account: '0xacc', from: 1791500000, to: 1791700000, coverageComplete: true, block: '1', blockHash: '0x' };

test('indexed Native, x402 and transfer rows score; unclassified transfers are excluded as related', async () => {
  const score = await indexedScore(
    { url: 'https://indexer.example/v1/graphql', fetch: indexer([
      row('1', 'native', '1000000', false),
      row('2', 'x402', '10000', false),
      row('3', 'transfer', '5000000', true, ['unclassified_inflow']),
    ]) },
    window,
  );
  assert.equal(score.rawRevenue, '6010000');
  assert.equal(score.relatedExcluded, '5000000');
  assert.equal(score.eligibleRevenue, '1010000');
});

test('a source the indexer never writes is refused', async () => {
  await assert.rejects(
    indexedScore({ url: 'https://indexer.example/v1/graphql', fetch: indexer([row('1', 'launchpad', '1', false)]) }, window),
    /Unknown source/,
  );
});
