# Build log

Everything in this repository was written during the Metropolis hackathon (from 1 September 2026). This file
records when, with what tools, and how the git history relates to the work.

## Timeline

| Date (2026) | Work | Evidence |
|---|---|---|
| 3–8 Oct | **Zeitgeist**, an attention-markets idea for Metropolis (Bancor category markets, a GDELT attention oracle). Abandoned; no code carried over | Public repository [`calledAdo/zeitgeist`](https://github.com/calledAdo/zeitgeist) (created 8 Oct); Codex session logs of 3 Oct |
| 9 Oct | **Pivot to Slice** (revenue bonds for onchain businesses, Track 1). First build in OpenAI Codex sessions, committed the same day as the two "Snapshot of Codex's … build" commits (`9fc79ac`, `5f26d57`), then handed over to Claude Code | Codex session logs of 9 Oct; this repository's first commits (9 Oct, 13:18 +01:00) |
| 9–10 Oct | Contracts (account, bond, factory, covenant), SDK, Envio indexer, Chainlink CRE workflow, x402 demo agent, web app; first testnet deployment | 61 commits |
| 11 Oct | Hackathon assessment; reviewed Native templates (`deployNative`), investor withdrawal during a raise, credit line, measured Monad confirmation times, the testnet deployment listed in the README, Kuru market, an open raise for judges | Commits from `e1c91f2` onwards; `llmtimeline/` |

The "Snapshot" commits are not a pre-existing codebase: they are the same-day Codex work, committed in
two steps when the build moved to Claude Code. Zeitgeist shares no code with Slice; the two projects
only share a testnet deployer wallet.

## AI tools

Built with AI pair-programming: OpenAI Codex (9 Oct), then Claude Code (Anthropic, 9 Oct onwards). The AI
wrote most of the code under the author's direction. Design decisions, review, testing and every deployment
were directed and checked by the author. `llmtimeline/` is the running work record shared between the agents.

## External code

See *Attribution* in the [README](README.md): OpenZeppelin Contracts, Foundry, viem, wagmi, Next.js,
Fumadocs, Tailwind CSS, lucide, Envio HyperIndex, the Chainlink CRE SDK, x402, the Kuru SDK and Mera, each
under its own license.
