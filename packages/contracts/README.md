# @bondrail/contracts

Solidity integration sources for Bondrail, version **0.1.0**. **Monad testnet prototype; not audited.**
Use Solidity **0.8.28**, the Cancun EVM target, and OpenZeppelin **5.4.0**.
Addresses belong to a deployment: use the [selected deployment](https://bondrail.vercel.app/docs/reference/deployments).

## Install with npm (Hardhat or Foundry)

```sh
npm i @bondrail/contracts@0.1.0
```

Release preparation does not imply publication. Until the package is published, clone the repository,
run `npm pack` inside `packages/contracts`, then install the resulting tarball in your project:

```sh
npm i /path/to/bondrail/packages/contracts/bondrail-contracts-0.1.0.tgz
```

OpenZeppelin is a pinned npm dependency. Hardhat resolves the imports below from `node_modules`.
For Foundry, put these in `remappings.txt` (or `foundry.toml`'s `remappings`):

```text
@bondrail/contracts/=node_modules/@bondrail/contracts/
@openzeppelin/contracts/=node_modules/@openzeppelin/contracts/
```

Set `solc_version = "0.8.28"`, `evm_version = "cancun"`, `optimizer = true`,
`optimizer_runs = 200` and `via_ir = true` in Foundry. Equivalent Hardhat compiler settings work.
Enable `viaIR` when compiling the full protocol implementations used by the local example.

## Install directly with Foundry

```sh
forge install calledAdo/bondrail@main
```

After the release tag exists, pin `forge install calledAdo/bondrail@contracts-v0.1.0` instead.
A Git tag must exist for `@<tag>` to resolve; this task does not create one. You can also pin a commit.
The repository includes OpenZeppelin sources under `contracts/lib`, so use:

```text
@bondrail/contracts/=lib/bondrail/contracts/
@openzeppelin/contracts/=lib/bondrail/contracts/lib/openzeppelin-contracts/contracts/
```

The Solidity import paths are identical for npm and Git installations. Git consumers use canonical
`contracts/src`; npm `prepack` copies those same files into package `src` and checks byte identity.
Never edit generated `packages/contracts/src`. See [release preparation](https://github.com/calledAdo/bondrail/blob/next/RELEASING.md).

## Inherit BondrailEarner

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {BondrailEarner} from "@bondrail/contracts/src/BondrailEarner.sol";

contract MyProject is BondrailEarner {
    constructor(address account) BondrailEarner(account) {}

    function pay(uint256 gross) external returns (uint256 net) {
        return _collect(msg.sender, gross, gross / 100); // 1% fee
    }
}
```

Create the account with `BondrailFactory.createAccount(asset)`, deploy the project with that account,
then have the issuer call `BondrailAccount.bindProject(project)`. The payer approves the **account**,
which pulls `gross`, books `fee` with the proven payer, and transfers `gross - fee` to the project.
Use `_collectWithPermit` for an EIP-2612 asset, or `_settleOut` for outgoing payments. Fee rates must
satisfy the bond's `minFeeBps()` while Active. The sample's small payments can round the 1% fee to zero;
choose payment bounds appropriate for your asset and fee policy. Never expose arbitrary-payer pulls
without authenticating that payer's intent.

**Custom contracts need an individual review before they can raise. Reviewed templates deployed
through `factory.deployNative` need no individual review.** Inheriting the base alone is insufficient:
the reviewer must call `setNativeApproval(project, true)` for custom projects. Template approval uses
`setNativeTemplate(keccak256(creationCode), true)`; `deployNative(account, creationCode, args, salt)`
deploys and binds approved code whose first constructor argument is the account. All raises still
need valid terms, history and the factory's health checks. See the
[Native guide](https://bondrail.vercel.app/docs/guides/native) and
[trust model](https://bondrail.vercel.app/docs/trust-model).

## Call Bondrail from your contract

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {BondrailBond} from "@bondrail/contracts/src/BondrailBond.sol";
import {IBondrailCreditRegistry} from "@bondrail/contracts/src/IBondrailCreditRegistry.sol";

contract LenderIntegration {
    using SafeERC20 for IERC20;

    function profile(IBondrailCreditRegistry registry, address account)
        external view returns (IBondrailCreditRegistry.OnchainProfile memory)
    {
        return registry.onchainProfile(account); // check complete and bondsCreated
    }

    function assessment(IBondrailCreditRegistry registry, address account)
        external view returns (IBondrailCreditRegistry.CreditAttestation memory a, address signer, bool valid)
    {
        return registry.attestedProfile(account); // valid = current signer + unexpired
    }

    function deposit(BondrailBond bond, uint256 amount) external {
        IERC20 token = bond.asset();
        token.safeTransferFrom(msg.sender, address(this), amount);
        token.forceApprove(address(bond), amount);
        bond.deposit(amount); // claims belong to this contract initially
        token.forceApprove(address(bond), 0);
        IERC20(address(bond)).safeTransfer(msg.sender, amount);
    }
}
```

This is an illustrative caller, not an underwriting policy. Authenticate the factory, bond, asset and
registry against your chosen deployment before approving funds. `BondrailBond.deposit` requires Funding,
an unexpired deadline, available raise capacity and `factory.depositAllowed`. A lender must decide how
to handle incomplete history and attester trust; booked revenue can include self-payments.

`IBondrailVault` extends `IERC4626`: quote entries with `previewDeposit` / `previewMint` and exits with
`previewWithdraw` / `previewRedeem`. `totalAssets` and conversions use **exit** valuation. Check
`maxWithdraw` / `maxRedeem` for idle liquidity; the vault does not sell bonds to satisfy withdrawals.

## Contents and verification

`BondrailTypes.sol` exports `BondrailTypes`, `IBondrailAccount`, `IBondrailBond`, `IBondrailFactory`,
`IBondrailEarner`, `IBondrailCovenant` and `IERC3009`. These protocol-facing interfaces are intentionally
small; import a concrete contract for functions outside their subset. Separate `IBondrailVault.sol`
and `IBondrailCreditRegistry.sol` expose integration views and operations. The package also ships the
real account, bond, factory, covenant, vault and registry sources for complete ABI access and local tests.

From the repository root, run `npx -y pnpm@10.32.0 contracts:verify`. It compares compiled selectors,
mutability and nested return types, packs with npm, checks the installed payload byte-for-byte, then
builds and tests [`examples/native-project`](https://github.com/calledAdo/bondrail/tree/next/examples/native-project)
outside the workspace. `prepublishOnly` runs the same verification. Nothing is published by this check.

`IBondrailVaultFactory` exposes bounded `vaults(offset, limit)` pages (1–100), membership, strategy metadata and creation. `BondrailVaultFactory` uses plain deployments with fixed original limits; the optional stricter-limit variant is not implemented. Names (64 bytes), symbols (16 bytes) and strategies (280 bytes) are bounded. A zero metadata hash means no external metadata. Legacy registration is owner-only and can succeed once; a separate verifier deploys an exact original reference with matching immutable values and compares runtime hashes. Build with the pinned compiler/settings to match the deployed legacy vault.
