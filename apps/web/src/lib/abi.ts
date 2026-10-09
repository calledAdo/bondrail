import { parseAbi } from 'viem';

// Narrow ABI fragments for the v1 contracts (contracts/src). Keep in sync with the Solidity sources.
const TERMS =
  '(uint256 raiseAmount,uint256 repayCap,uint256 stake,uint256 minRevenue,uint64 fundingDeadline,uint64 maturity,uint64 secondReleaseNotBefore,uint64 secondReleaseDeadline,uint32 minOperatingPeriod,uint16 revenueBps,uint16 firstReleaseBps,uint8 milestoneMode)';

export const bondAbi = parseAbi([
  'function phase() view returns (uint8)',
  'function issuer() view returns (address)',
  'function account() view returns (address)',
  'function adapter() view returns (uint8)',
  'function fundingEscrow() view returns (uint256)',
  'function releasedPrincipal() view returns (uint256)',
  'function undrawnPrincipal() view returns (uint256)',
  'function principalRecovery() view returns (uint256)',
  'function revenuePool() view returns (uint256)',
  'function stakeRecovery() view returns (uint256)',
  'function stakeHeld() view returns (uint256)',
  'function pool() view returns (uint256)',
  'function defaultedAt() view returns (uint64)',
  'function effectiveRevenueCap() view returns (uint256)',
  'function revenueSnapshot() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function backingPerToken() view returns (uint256)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  `function terms() view returns (${TERMS})`,
  'function deposit(uint256 amount)',
  'function expireUndrawn()',
  'function finalizeSettlement()',
  'function refund(uint256 amount,address to)',
  'function redeem(uint256 amount,address to)',
]);

/** A business's SliceAccount: revenue address, payment entrypoint and on-chain credit history. */
export const accountAbi = parseAbi([
  'function issuer() view returns (address)',
  'function project() view returns (address)',
  'function activeBond() view returns (address)',
  'function issuerCredit() view returns (uint256)',
  'function cumulativeRevenue() view returns (uint256)',
  'function paymentCount() view returns (uint64)',
  'function collectedCount() view returns (uint64)',
  'function uniquePayers() view returns (uint64)',
  'function firstRevenueAt() view returns (uint64)',
  'function lastRevenueAt() view returns (uint64)',
  'function sweep()',
  'function withdraw(address to,uint256 amount)',
  'function closeBondAtMaturity(address expectedBond)',
  'function cancelFunding(address expectedBond)',
]);

export const factoryAbi = parseAbi([
  'function createAccount() returns (address account)',
  'function createNativeLaunchpad(address account,string name,string symbol) returns (address source)',
  'function createLockedLaunchpad(address account,string name,string symbol,uint16 maxNameLength) returns (address source,address guard)',
  `function createBond(address account,${TERMS} terms,(uint8 adapter,address source,address guard,bytes32 policyHash) config,string name,string symbol) returns (address bond)`,
  'function activate(address bond)',
  'function releaseSecond(address bond)',
  'function releaseSecondSigned(address bond,(address bond,bytes32 policyHash,uint64 periodStart,uint64 periodEnd,uint256 eligibleRevenue,bytes32 evidenceHash,uint64 expiresAt,uint256 nonce) milestone,bytes signature)',
  'event AccountCreated(address indexed issuer,address indexed account)',
  'event NativeSourceCreated(address indexed issuer,address indexed account,address source,address token)',
  'event LockedSourceCreated(address indexed issuer,address indexed account,address source,address guard,address token)',
  'event BondCreated(address indexed issuer,address indexed account,address indexed bond,uint8 adapter,bytes32 policyHash,bytes32 termsHash)',
]);
