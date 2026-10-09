import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeEventTopics, encodeAbiParameters, parseAbi, type Address, type Hex } from 'viem';
import { receiptProvesPayment } from '../src/lib/reconcile';
import type { PaymentRecord } from '../src/lib/payment';

const payer = '0x1111111111111111111111111111111111111111' as Address;
const recipient = '0x2222222222222222222222222222222222222222' as Address;
const token = '0x3333333333333333333333333333333333333333' as Address;
const nonce = `0x${'44'.repeat(32)}` as Hex;
const abi = parseAbi([
  'event Transfer(address indexed from,address indexed to,uint256 value)',
  'event AuthorizationUsed(address indexed authorizer,bytes32 indexed nonce)',
]);
const record: PaymentRecord = {
  state: 'settlement_pending',
  binding: 'test',
  payloadHash: 'test',
  requirements: {
    scheme: 'exact',
    network: 'eip155:10143',
    asset: token,
    amount: '10000',
    payTo: recipient,
    maxTimeoutSeconds: 300,
    extra: {},
  },
  payer,
  nonce,
  resource: 'https://example.com/api/oracle',
  createdAt: '2026-10-09',
  answer: 'cached answer',
};
const transfer = {
  address: token,
  data: encodeAbiParameters([{ type: 'uint256' }], [10000n]),
  topics: encodeEventTopics({
    abi,
    eventName: 'Transfer',
    args: { from: payer, to: recipient },
  }) as Hex[],
};
const used = {
  address: token,
  data: '0x' as Hex,
  topics: encodeEventTopics({
    abi,
    eventName: 'AuthorizationUsed',
    args: { authorizer: payer, nonce },
  }) as Hex[],
};
test('reconciliation requires exact token, amount, destination and authorization nonce', () => {
  assert.equal(receiptProvesPayment(record, [transfer, used]), true);
  assert.equal(receiptProvesPayment(record, [transfer]), false);
  assert.equal(receiptProvesPayment(record, [used]), false);
  assert.equal(receiptProvesPayment(record, [{ ...transfer, address: recipient }, used]), false);
  assert.equal(
    receiptProvesPayment(record, [
      {
        ...transfer,
        data: encodeAbiParameters([{ type: 'uint256' }], [9999n]),
      },
      used,
    ]),
    false,
  );
  assert.equal(receiptProvesPayment({ ...record, nonce: `0x${'55'.repeat(32)}` }, [transfer, used]), false);
  assert.equal(
    receiptProvesPayment({ ...record, requirements: { ...record.requirements, payTo: payer } }, [
      transfer,
      used,
    ]),
    false,
  );
});
