import test from 'node:test';
import assert from 'node:assert/strict';
import { awaitingActivation } from './protocol';

test('fully funded raises remain in Raising until activation', () => {
  assert.equal(awaitingActivation('Funding', 2, 2), true);
  assert.equal(awaitingActivation('Funding', 1.99, 2), false);
  assert.equal(awaitingActivation('Active', 2, 2), false);
});
