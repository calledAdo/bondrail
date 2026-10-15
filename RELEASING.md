# Release preparation

Package releases and repository releases have separate tags:

| Release | Version source | Tag scheme / initial prepared tag |
| --- | --- | --- |
| Solidity package | `packages/contracts/package.json` | `contracts-v0.1.0` |
| TypeScript SDK | `packages/sdk/package.json` | `sdk-v0.1.1` |
| Repository milestone | Root `package.json` | `v0.x` (for example `v0.2.0`) |

Keep package changelogs and versions aligned before choosing a release commit. Package versions do
not automatically bump the other package or the repository. `forge install calledAdo/bondrail@<tag>`
requires that Git tag to exist in the remote repository; preparing npm metadata does not create it.
Use the Solidity package tag to pin a reviewed source snapshot. Until tags are created, development
consumers can install `calledAdo/bondrail@next` or pin a commit, with the remappings in the contracts README.
The repository vendors OpenZeppelin under `contracts/lib`; npm consumers receive its pinned dependency.

Before any separately authorized release, on the selected commit:

```sh
~/.foundry/bin/forge test --root contracts
npx -y pnpm@10.32.0 contracts:verify
npx -y pnpm@10.32.0 sdk:verify
npx -y pnpm@10.32.0 build:apps
npx -y pnpm@10.32.0 -r test
npx -y pnpm@10.32.0 typecheck
npx -y pnpm@10.32.0 exec tsc --noEmit
npx -y pnpm@10.32.0 exec tsc -p scripts/tsconfig.json
npx -y pnpm@10.32.0 exec tsc -p scripts/bench/tsconfig.json
npx -y pnpm@10.32.0 --dir indexer exec tsc --noEmit
```

Inspect `npm pack --dry-run` in each package. Contracts `prepack` regenerates sources and checks
byte identity; `contracts:verify` also compares the installed payload and interface ABIs, then builds
and tests an external Foundry consumer. `prepublishOnly` runs that verifier; SDK publication has its
own isolated plain-Node verifier. These checks never publish, deploy or create tags.

Only after release approval should the operator create/push the appropriate tag and publish the
corresponding package with public access. No tags or publications are created by Task 16.
Never overwrite `docs/deployments/10143.json`: it identifies the Metropolis submission (judged).
Use a named deployment manifest for any future deployment; package releases do not deploy contracts.
