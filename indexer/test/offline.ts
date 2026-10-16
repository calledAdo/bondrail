// All simulated handler suites run with outbound networking disabled, not mocked RPC replies.
import { after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Socket } from 'node:net';
import dgram from 'node:dgram';
let attempts = 0;
const deny = () => { attempts++; throw new Error('Network access forbidden in indexer event tests'); };
mock.method(globalThis, 'fetch', deny);
mock.method(Socket.prototype, 'connect', deny);
mock.method(dgram, 'createSocket', deny);
after(() => { assert.equal(attempts, 0, 'even swallowed network attempts must fail the offline regression'); });
