import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { validCode, newSession, validSession, sameOrigin } from './demo-auth.ts';

const previous = process.env.DEMO_ACCESS_CODE;
process.env.DEMO_ACCESS_CODE = 'local-test-code-never-a-deployed-credential';
after(() => {
  if (previous === undefined) delete process.env.DEMO_ACCESS_CODE;
  else process.env.DEMO_ACCESS_CODE = previous;
});

test('only the configured code establishes an authentic session', () => {
  assert.equal(validCode('wrong'), false);
  assert.equal(validCode({ code: process.env.DEMO_ACCESS_CODE }), false);
  assert.equal(validCode(process.env.DEMO_ACCESS_CODE), true);
  const session = newSession();
  assert.equal(validSession(session), true);
  assert.equal(validSession(`${session.slice(0, -1)}${session.endsWith('0') ? '1' : '0'}`), false);
  assert.equal(validSession(`${session}.extra`), false);
});

test('expired signatures and malformed cookies never authorize controls', () => {
  const body = `${Math.floor(Date.now() / 1000) - 60}.${'a'.repeat(32)}`;
  const signature = createHmac('sha256', process.env.DEMO_ACCESS_CODE).update(body).digest('hex');
  assert.equal(validSession(`${body}.${signature}`), false);
  for (const value of [undefined, '', 'not-a-session', '10.zz.bad']) assert.equal(validSession(value), false);
});

test('disabled configuration invalidates sessions and rejects codes', () => {
  const code = process.env.DEMO_ACCESS_CODE;
  const session = newSession();
  delete process.env.DEMO_ACCESS_CODE;
  assert.equal(validSession(session), false);
  assert.equal(validCode(''), false);
  process.env.DEMO_ACCESS_CODE = code;
});

test('mutating controls require an explicit same-origin request', () => {
  assert.equal(
    sameOrigin(
      new Request('https://slice.test/api/demo/action', {
        headers: { origin: 'https://slice.test', 'sec-fetch-site': 'same-origin' },
      }),
    ),
    true,
  );
  assert.equal(
    sameOrigin(
      new Request('https://slice.test/api/demo/action', { headers: { origin: 'https://attacker.test' } }),
    ),
    false,
  );
  assert.equal(sameOrigin(new Request('https://slice.test/api/demo/action')), false);
  assert.equal(
    sameOrigin(
      new Request('https://slice.test/api/demo/action', {
        headers: { origin: 'https://slice.test', 'sec-fetch-site': 'cross-site' },
      }),
    ),
    false,
  );
});
