# Slice contracts

Solidity0.8.28, OpenZeppelin5.4.0 (vendored), Foundry. Prototype contracts; passing tests are not a production audit.

```
forge build --sizes
forge test --summary
```

The public schema and integration calls are in `INTERFACE.md`. Generated artifacts under `out/` are the ABI authority. No mainnet deployment path is enabled.

`script/Deploy.s.sol:Deploy` reads `DEPLOYER_PRIVATE_KEY` without logging it. For Monad testnet10143 also configure verified `USDC_ADDRESS`, `CRE_FORWARDER`, `OBSERVATION_SIGNER`, `MILESTONE_SIGNER`. Local31337 may deploy a clearly named mock token and defaults to known public test signer keys12345/67890; these defaults must never be used for money or external deployment. The local mock does not implement EIP-3009 and cannot validate x402 facilitator compatibility.

Deployment order: implementations, Covenant, Factory, one-shot Covenant.initializeFactory. Factory creates deterministic-behavior clones of the recognized implementations and deploys recognized immutable PumpLab sources/guards. `createBond` requires stake allowance to Factory. Deposits require principal allowance to the individual Bond.

Revenue accounting uses the Router's actual free USDC balance; unsolicited Router transfers are split but are not evidence of business revenue. Bond donations remain surplus. Closure requires no service availability. Watched closing preserves a fixed120-second historical-report window, while each observation still has90-second freshness and5-second maximum clock skew.

The observer and milestone signer are explicit trusted evaluators. Forwarder delivery alone cannot forge their signatures. The direct signed-observation utility has the same app-signer trust and never represents DON consensus.
