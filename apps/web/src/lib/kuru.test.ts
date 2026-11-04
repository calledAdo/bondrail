import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldQuoteOrder } from './kuru';

test('valid ready orders can be quoted without an allowance', () => {
  assert.equal(shouldQuoteOrder(true, true), true);
  assert.equal(shouldQuoteOrder(true, false), false);
  assert.equal(shouldQuoteOrder(false, true), false);
});
