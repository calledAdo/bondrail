import test from 'node:test';
import assert from 'node:assert/strict';
import { bondAction, bondRisks, bondSummary, bondTimeline, depositPauseReason, purchaseEstimate } from './bond-decision';
import { bondFixtures, fixtureAccount, FIXTURE_NOW, marketFixture } from './bond-fixtures';

const activeSentence = 'Fixture Studio raised $1,000.00 of $1,000.00. Claim holders receive 25% of its revenue (rising to 50% if revenue falls below $100.00 over 7 days) until $1,500.00 has been repaid or Jan 14, 2027. $200.00 repaid so far.';
const fundingSentence = 'Fixture Studio is raising $1,000.00. If fully funded by Oct 17, 2026, claim holders receive 25% of its revenue (rising to 50% if revenue falls below $100.00 over 7 days) until $1,500.00 has been repaid or Jan 14, 2027. $0.00 repaid so far.';
const expected = {
  Funding: [fundingSentence, 'Raising', 'Deposit'],
  'Funding-paused': [fundingSentence, 'Raising', null],
  Active: [activeSentence, 'Repaying', null],
  'Active-triggered': [activeSentence.replace('over 7 days)', 'over 7 days) — currently stepped up'), 'Repaying', null],
  'Active-defaulted': [activeSentence + ' The issuer defaulted on Oct 15, 2026; recovered funds are being paid to claim holders.', 'Default recovery', null],
  Closing: [activeSentence.replace('$200.00 repaid', '$750.00 repaid'), 'Settled', null],
  Closed: [activeSentence.replace('$200.00 repaid', '$750.00 repaid'), 'Settled', 'Redeem'],
  Cancelled: ["This raise didn't complete. Every deposit can be refunded in full.", 'Raise cancelled', 'Refund'],
} as const;
for (const [phase, b] of Object.entries(bondFixtures)) {
  test(`${phase}: exact sentence, one current timeline step and phase action`, () => {
    const [sentence, current, primary] = expected[phase as keyof typeof expected];
    assert.equal(bondSummary(b), sentence);
    const steps = bondTimeline(b, FIXTURE_NOW);
    assert.deepEqual(steps.filter(s => s.state === 'current').map(s => s.title), [current]);
    assert.equal(bondAction(b, FIXTURE_NOW).primary, primary);
    if (b.defaulted || b.phase === 'Cancelled') assert.ok(!steps.some(s => s.title === 'Milestone'));
    else assert.deepEqual(steps.map(s => s.title), ['Raising', 'Released', 'Milestone', 'Repaying', 'Maturity', 'Settled']);
  });
}
test('no trigger, singular day, unavailable default date, milestone completion/expiry', () => {
  assert.ok(!bondSummary({ ...bondFixtures.Active, triggerWindowDays: 0 }).includes('rising'));
  assert.match(bondSummary({ ...bondFixtures.Active, triggerWindowDays: 1 }), /over 1 day\)/);
  assert.match(bondSummary({ ...bondFixtures['Active-defaulted'], defaultedAt: undefined }), /unreported date/);
  assert.equal(bondTimeline({ ...bondFixtures.Active, released: 1000, undrawn: 0 }, FIXTURE_NOW)[2].state, 'complete');
  assert.equal(bondTimeline(bondFixtures.Active, FIXTURE_NOW + 20 * 86400)[2].state, 'skipped');
});
test('Funding health unknown, expired and full all pause; market enables Buy', () => {
  assert.match(depositPauseReason({ ...bondFixtures.Funding, depositAllowed: undefined }, FIXTURE_NOW)!, /could not be verified/);
  assert.match(depositPauseReason(bondFixtures.Funding, FIXTURE_NOW + 2 * 86400)!, /deadline/);
  assert.match(depositPauseReason({ ...bondFixtures.Funding, raised: 1000 }, FIXTURE_NOW)!, /full/);
  assert.equal(bondAction(marketFixture, FIXTURE_NOW).primary, 'Buy claims');
});
test('Funding calculator uses full supply, initial effective cap, and returns undrawn only once', () => {
  const estimate = purchaseEstimate(bondFixtures.Funding, fixtureAccount, 10, 2, FIXTURE_NOW)!;
  assert.equal(estimate.claims, 10); // par even when a quote is supplied
  assert.equal(estimate.stopped, 5);
  assert.equal(estimate.expected, 12.5);
  assert.equal(estimate.best, 15);
  assert.equal(estimate.gain, 0.25);
  assert.equal(estimate.paybackDays, 90); // principal only returns at maturity
});
test('Active calculator uses ask, includes recovery once, caps revenue and handles zero revenue', () => {
  const estimate = purchaseEstimate(marketFixture, fixtureAccount, 10, 0.5, FIXTURE_NOW)!;
  assert.equal(estimate.claims, 20);
  assert.equal(estimate.stopped, 14);
  assert.equal(estimate.expected, 25);
  assert.equal(estimate.best, 30);
  const stopped = purchaseEstimate(marketFixture, { verifiedDaily: 0 }, 10, 1, FIXTURE_NOW)!;
  assert.equal(stopped.expected, stopped.stopped);
  assert.equal(stopped.paybackDays, null);
  const recovered = purchaseEstimate({ ...marketFixture, pool: 800, undrawn: 0, defaulted: true }, fixtureAccount, 10, 1, FIXTURE_NOW)!;
  assert.equal(recovered.stopped, 8);
  assert.equal(recovered.best, 13.5);
});
test('missing market, quote, USD conversion, supply or revenue never fabricate estimates', () => {
  assert.equal(purchaseEstimate(bondFixtures.Active, fixtureAccount, 10, 1, FIXTURE_NOW), null);
  assert.equal(purchaseEstimate(marketFixture, fixtureAccount, 10, null, FIXTURE_NOW), null);
  assert.equal(purchaseEstimate({ ...marketFixture, asset: { ...marketFixture.asset, symbol: 'MON' } }, fixtureAccount, 10, 1, FIXTURE_NOW), null);
  assert.equal(purchaseEstimate({ ...marketFixture, supply: 0 }, fixtureAccount, 10, 1, FIXTURE_NOW), null);
  assert.equal(purchaseEstimate(marketFixture, undefined, 10, 1, FIXTURE_NOW)!.expected, null);
  assert.equal(purchaseEstimate(marketFixture, fixtureAccount, NaN, 1, FIXTURE_NOW), null);
});

test('settlement does not imply a future maturity date has occurred; terminal risks describe remaining exposure', () => {
  const timeline = bondTimeline(bondFixtures.Closing, FIXTURE_NOW);
  assert.equal(timeline.find(s => s.title === 'Maturity')!.state, 'skipped');
  assert.equal(timeline.find(s => s.title === 'Settled')!.state, 'current');
  assert.match(bondRisks(bondFixtures.Cancelled, FIXTURE_NOW)[0], /refundable in full/);
  assert.ok(!bondRisks(bondFixtures.Closed, FIXTURE_NOW).some(s => s.includes('early redemption')));
  const matured = purchaseEstimate(marketFixture, fixtureAccount, 10, 1, marketFixture.maturity)!;
  assert.equal(matured.best, matured.stopped);
});
