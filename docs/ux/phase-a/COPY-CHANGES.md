# Phase A copy inventory

This lists every user-facing copy change in Task 21. Unchanged button names are listed only where their new explanatory text matters.

## Landing

| Location | Previous copy or implication | Replacement |
| --- | --- | --- |
| Split diagram caption | Paid API receipts use a separate collection transaction. | Native fees and x402 payments settled through `BondrailAccount.settle` via the Bondrail facilitator split in the same transaction. Plain transfers still need `sweep` to book and split them. |
| Live statistics label | Paid to investors | Collected for investors |
| Live statistics footnote | Testnet/source/demo disclosure only. | Adds that dollar totals use the deployment’s USDC, counts include all indexed accounts, and collected means revenue sent to bond pools rather than holder redemptions. Retains the testnet, Envio and team-run demo disclosure. |
| How it works: build history | Every payment is booked with its payer. | Native fees and account settlements prove a payer on-chain; plain transfers are booked by sweep without a proven payer. |
| How it works: route revenue | A fixed share; paid API receipts need collection. | The current revenue share goes toward repayment, up to the cap. Specifies same-transaction Native fees and Bondrail-facilitated `settle`, versus plain transfers needing sweep. |
| Two tiers heading | Impossible to divert, or expensive to. | Routing enforced in code, or monitored. |
| Native tier description | Every fee moves through the account; there is no other path. | Reviewed templates or individually reviewed projects route fees through their bound account using `BondrailEarner`. Review covers the disclosed path and does not guarantee future business revenue. |
| Builder audience description | Route revenue in an afternoon; raise when history speaks for itself. | Route revenue through an account, build history, then set terms investors can assess. |
| Builder audience addition | No package links. | “Build with the npm packages @bondrail/sdk and @bondrail/contracts.” Links to `/docs/reference/sdk` and `/docs/reference/contracts`. |
| Investor audience description | Redeem at any time or trade on Kuru. | Assess revenue, concentration and coverage; buy on Kuru where listed or fund a raise. Early redemption burns claims for current backing and gives up future receipts. |
| Investor audience addition | No vault/profile/trigger introduction. | Introduces the credit vault (`/vault`), credit profiles (`/docs/concepts/credit-profiles`) and performance triggers (`/docs/concepts/bond#performance-trigger`) that can raise the investor share when revenue falls. |
| FAQ: Who can stop the split? | Nobody; split happens inside every payment. | Distinguishes immediate Native/account settlement splits from plain-transfer sweep. Revocation blocks deposits/releases unless another approval applies; live repayment continues. |
| FAQ: What do I rely on? | Reviewer, milestone signer, observer; everything else enforced by contracts. | Adds template approval, signed-assessment attester trust and the vault curator’s allocations within contract limits. |
| FAQ: What if the business stops? | Investors keep undrawn capital and Watched slashed stake. | Holders retain the collected pool and undrawn capital when recovered; Watched stake only goes to investors on a recorded default. Coverage and available Kuru prices do not guarantee repayment. |
| FAQ: Can revenue be faked? | Only verified revenue scores. | Attribution excludes detected issuer links/plain transfers but does not prove independence. Performance triggers count all booked revenue, including self-payments. |
| FAQ: Is this live? | All demo activity is labelled. | Monad testnet, team-run demo businesses and traffic; contracts are not audited. |

## Bond and account pages

| Location | Previous copy or implication | Replacement |
| --- | --- | --- |
| Native source introduction | Every fee moves through the account; no other fee path. | Native projects route fees through the bound account; review covers that path and does not guarantee future revenue. |
| Source status/account badge | Reviewed / Awaiting review | `Deployed from a reviewed template`; `Individually reviewed project`; `Template approval revoked`; `Unreviewed or approval revoked`; `Review status unavailable`, selected from current factory reads. |
| Native source explanation: template | Reviewer checked this project individually. | “The factory deployed approved creation code; this project did not need an individual review.” |
| Native source explanation: individual | Generic reviewed text. | “The disclosed reviewer approved this project individually.” |
| Native source explanation: unavailable | Awaiting review. | “Current factory approval could not be verified.” |
| Native source explanation: unapproved/revoked | Cannot raise until code reviewed. | “No current approval: new deposits and releases are blocked. Existing repayment continues.” |
| Base revenue share term | Percent of each payment. | Percent of booked revenue. |
| Action panel heading | Act | Funding: `Fund this bond`; Closed: `Redeem claims`; Cancelled: `Refund claims`; Active/Closing: `Your claims`. |
| Funding withdrawal help | Until the raise closes, take the deposit back. | Before activation **and** the funding deadline, take the deposit back; claims burn 1:1 and activation needs the full raise. |
| Early redemption help | Long acknowledgement beside the main action; selling on Kuru keeps rights “priced in.” | “Early redemption burns claims for current backing and gives up their future receipts.” Removes the unsupported pricing promise. |
| Oversized claim amount | No inline explanation. | “Enter no more than your claim balance.” |
| Account collected-for-investors explanation | Across all bonds, split inside each payment. | Revenue sent to pools across bonds; Native fees/account settlements split immediately, plain transfers when swept; distinct from holder redemptions. |
| No-market yield state | A panel of missing values. | “No market yet — yield appears once claims trade”. Funding adds “Funding estimate below uses the par price.” |
| Funding yield assumption | Generic trailing-rate disclaimer only. | Adds that the full raise activates at the funding deadline, only the initial release occurs, and later releases/capital/stake recoveries are excluded. |

## Early redemption confirmation (new)

- Title: **Confirm early redemption**.
- Warning: “This permanently burns your selected claims for their current cash backing. You give up all future receipts on those claims, including revenue and any later capital or stake recovery.”
- Figures: **Claims burned**, **Cash received now**, **Estimated additional revenue by maturity**, **Estimated total if held**.
- Missing estimates: **Unavailable — missing revenue history** and **Unavailable**.
- Active estimate explanation: trailing attributed daily revenue, current investor share, remaining cap and maturity; unchanged supply/terms; excludes future capital/stake recovery; not a guarantee.
- Closing explanation: “Revenue collection has ended, so no additional revenue is projected. Settlement may still recover stake.”
- Execution explanation: “Cash is based on the latest read; the transaction uses the pool and supply when executed.”
- Acknowledgement: “I understand that these claims are burned and I give up their future receipts.”
- Actions: **Keep my claims** and **Burn claims and redeem**.

## Maintenance (collapsed by default)

Replaces the always-visible **Anyone** heading with **Maintenance (anyone can run)**.

| Action | Added explanation |
| --- | --- |
| Book pending transfers (sweep) | Book and split plain transfers waiting in the account. Bondrail-facilitated account settlements are already split. |
| Check performance trigger (new control) | Check complete UTC revenue days and update the investor share if the performance trigger applies. Success label: “Trigger checked”. |
| Record bond (new control) | Add this bond to the account’s registry repayment record if it has not been recorded yet. Success label: “Bond recorded”. |
| Cancel the unfilled raise | End the expired funding round so depositors can claim refunds. |
| Close at maturity | Stop revenue collection at maturity and recover undrawn capital. |
| Return undrawn capital to investors | Recover capital after the second release window has expired. |
| Finalize settlement | End the reporting grace period so the last outstanding claims can redeem. |

## Issuer console and operations

- Console code-review status uses the same five precise Native review labels above; a revoked template with independent project approval is described as individually reviewed.
- Console activation summary changes “percent of every payment” to “percent of booked revenue”.
- Revenue-share form hint changes “Of every payment while the bond is live” to “Of booked revenue while the bond collects repayment”.
- `ops-status --help` describes the explicit health-URL override and the host/port-derived default, with fallback `127.0.0.1:8789`.
- Operations runbook example supplies production `FACILITATOR_HOST=172.18.0.1 FACILITATOR_PORT=8789`; prose explains precedence, fallback and the need to pass the service bind address when running outside its environment.
