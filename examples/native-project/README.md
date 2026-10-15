# External Native project

This directory is deliberately outside `pnpm-workspace.yaml`. It imports only npm package paths,
including the real protocol implementations used for local tests. No RPC or deployment is needed.

From the repository root, `npx -y pnpm@10.32.0 contracts:verify` packs with npm, copies this project
to a temporary directory outside the repository, installs the tarball and its OpenZeppelin dependency,
then runs `forge build` and `forge test`. It checks a custom project's review gate, payer attribution,
fee splitting before/after activation, nested credit profile decoding, and vault entry/exit calls.

To run it manually from this directory after packing the package:

```sh
npm install --no-save ../../packages/contracts/bondrail-contracts-0.1.0.tgz
forge build
forge test -v
```

Create the tarball with `cd packages/contracts && npm pack` from the repository root first.
The token is a local mock; all Bondrail contracts are the actual packaged sources. `NativeProject`
is illustrative, not an approved template. A custom project needs individual review before raising.
