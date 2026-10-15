import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeReviewStatus } from './native-review';

test('native review distinguishes current template and individual approvals, revocation and unknown reads', () => {
  const zero = `0x${'0'.repeat(64)}`;
  const template = `0x${'1'.repeat(64)}`;
  assert.equal(nativeReviewStatus(false, template, true), 'template');
  assert.equal(nativeReviewStatus(true, zero, false), 'individual');
  assert.equal(nativeReviewStatus(true, template, false), 'individual');
  assert.equal(nativeReviewStatus(false, template, false), 'template-revoked');
  assert.equal(nativeReviewStatus(false, zero, undefined), 'unreviewed');
  assert.equal(nativeReviewStatus(false, template, undefined), 'unknown');
  assert.equal(nativeReviewStatus(undefined, undefined, undefined), 'unknown');
});
