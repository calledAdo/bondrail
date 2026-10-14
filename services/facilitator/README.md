# Bondrail x402 facilitator

**Not yet deployed.** Supports x402 v2 `exact` EIP-3009 payments on `eip155:10143`. `GET /supported`, `POST /verify` and `POST /settle` work with the agent's `@x402/core` HTTP client. POST bodies contain `{x402Version: 2, paymentPayload, paymentRequirements}`; responses use `VerifyResponse` / `SettleResponse`.

Copy `.env.example` to `.env`, replace the placeholders, and run from this directory:

```sh
npx -y pnpm@10.32.0 exec tsx --env-file=.env src/server.ts
```

Configure a **new factory deployed with the settlement-capable account implementation**. Existing immutable clones cannot gain `settle`; simulation rejects them. Set the agent's `X402_FACILITATOR_URL` to this service's HTTPS origin. The agent's default external facilitator remains until explicitly configured. Deployment addresses are not changed here.

The operator pins the factory and token. The signature domain is `USDC`, version `2`, chain `10143`, at the configured asset. Verification checks signature, offer/authorization agreement, strict time window, factory registration, account asset, unused nonce, sufficient funds, and simulation of `account.settle`. Only 65-byte EOA signatures are supported by this v/r/s interface. The facilitator key pays gas; it never receives or approves payer funds. Success requires a successful transaction receipt.

Use one process per gas key. Writes are serialized and revalidated before submission. A receipt timeout returns `settlement_pending` with the known broadcast hash. Used authorizations are refused, including after restart. The agent's durable journal and authenticated receipt reconciliation handle ambiguous outcomes; no automatic replacement authorization is issued. HTTP timeouts can happen after broadcast: inspect the gas wallet's transactions if the caller received no hash.

Anyone can submit the signature directly to USDC first. The recipient stays fixed, but account settlement then reverts with a used nonce. These funds require `sweep()` and do not establish a proven on-chain payer. For public operation, configure HTTPS and request/gas-budget limits at the gateway: valid signed micropayments can spend facilitator gas, and simulation cannot eliminate inclusion races. Keep this key separate from issuer, observer, and milestone keys.

```sh
npx -y pnpm@10.32.0 --filter @bondrail/facilitator test
npx -y pnpm@10.32.0 --filter @bondrail/facilitator typecheck
```

Tests use real EIP-712 signatures, mocked chain clients, and the agent's actual SDK client over local HTTP. Live Monad/USDC settlement remains a check after deployment.
