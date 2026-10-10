// Typed helpers over the Slice protocol contracts. Bring your own viem clients; every write simulates
// first, sends with a padded gas limit (Monad bills the limit) and waits for a successful receipt.
import {
  decodeEventLog,
  type Abi,
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
} from 'viem';
import { sliceAccountAbi, sliceBondAbi, sliceFactoryAbi } from './abis';

export const Tier = { Native: 0, Watched: 1 } as const;
export const MilestoneMode = { Onchain: 0, Signed: 1 } as const;

export interface BondTerms {
  raiseAmount: bigint;
  repayCap: bigint;
  stake: bigint;
  minRevenue: bigint;
  fundingDeadline: bigint;
  maturity: bigint;
  secondReleaseNotBefore: bigint;
  secondReleaseDeadline: bigint;
  minOperatingPeriod: number;
  revenueBps: number;
  firstReleaseBps: 2500 | 5000;
  milestoneMode: (typeof MilestoneMode)[keyof typeof MilestoneMode];
}

export interface CreditHistory {
  cumulativeRevenue: bigint;
  paymentCount: bigint;
  collectedCount: bigint;
  uniquePayers: bigint;
  firstRevenueAt: bigint;
  lastRevenueAt: bigint;
  issuerCredit: bigint;
  activeBond: Address;
  project: Address;
}

type Wallet = WalletClient<Transport, Chain, Account>;

export function sliceClient(opts: { publicClient: PublicClient; walletClient?: Wallet; factory: Address }) {
  const { publicClient, walletClient, factory } = opts;

  async function write(address: Address, abi: Abi, functionName: string, args: unknown[] = []) {
    if (!walletClient) throw new Error('A wallet client is required for writes');
    const account = walletClient.account;
    const { request } = await publicClient.simulateContract({ account, address, abi, functionName, args } as never);
    const gas = await publicClient.estimateContractGas({ account, address, abi, functionName, args } as never);
    const hash = await walletClient.writeContract({ ...(request as object), gas: (gas * 13n) / 10n } as never);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') throw new Error(`${functionName} reverted (${hash})`);
    return receipt;
  }

  function factoryEvent<T>(receipt: { logs: { data: Hex; topics: Hex[] }[] }, eventName: string): T {
    for (const log of receipt.logs) {
      try {
        const e = decodeEventLog({ abi: sliceFactoryAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
        if (e.eventName === eventName) return e.args as T;
      } catch {}
    }
    throw new Error(`${eventName} not found`);
  }

  return {
    /** Create the business's SliceAccount. Do it on day one: history starts at the first payment. */
    async createAccount(): Promise<Address> {
      const r = await write(factory, sliceFactoryAbi as Abi, 'createAccount');
      return factoryEvent<{ account: Address }>(r as never, 'AccountCreated').account;
    },

    /** Native: bind a project that inherits SliceEarner and points at this account (issuer only, once). */
    bindProject: (account: Address, project: Address) =>
      write(account, sliceAccountAbi as Abi, 'bindProject', [project]),


    /**
     * Create a bond. Approve `terms.stake` of USDC to the factory first if the stake is non-zero (Watched
     * requires one). The account needs `factory.minHistory()` seconds since its first booked payment.
     */
    async createBond(o: {
      account: Address;
      terms: BondTerms;
      tier: (typeof Tier)[keyof typeof Tier];
      source?: Address;
      policyHash: Hex;
      name: string;
      symbol: string;
    }): Promise<Address> {
      const zero = '0x0000000000000000000000000000000000000000';
      const r = await write(factory, sliceFactoryAbi as Abi, 'createBond', [
        o.account,
        o.terms,
        { adapter: o.tier, source: o.source ?? zero, policyHash: o.policyHash },
        o.name,
        o.symbol,
      ]);
      return factoryEvent<{ bond: Address }>(r as never, 'BondCreated').bond;
    },

    activate: (bond: Address) => write(factory, sliceFactoryAbi as Abi, 'activate', [bond]),
    /** Second release, on-chain milestone mode. */
    releaseSecond: (bond: Address) => write(factory, sliceFactoryAbi as Abi, 'releaseSecond', [bond]),
    /** Book plain transfers (x402 settlements, other inflows) into history and split them. */
    sweep: (account: Address) => write(account, sliceAccountAbi as Abi, 'sweep'),
    withdraw: (account: Address, to: Address, amount: bigint) =>
      write(account, sliceAccountAbi as Abi, 'withdraw', [to, amount]),
    deposit: (bond: Address, amount: bigint) => write(bond, sliceBondAbi as Abi, 'deposit', [amount]),
    redeem: (bond: Address, tokens: bigint, to: Address) =>
      write(bond, sliceBondAbi as Abi, 'redeem', [tokens, to]),
    /** Whether investors can deposit now (Native: still reviewed and bound; Watched: not in violation). */
    depositAllowed: (bond: Address) =>
      publicClient.readContract({ address: factory, abi: sliceFactoryAbi, functionName: 'depositAllowed', args: [bond] }),

    /** The account's on-chain credit history (every booked payment since its first). */
    async creditHistory(account: Address): Promise<CreditHistory> {
      const read = (functionName: string) =>
        publicClient.readContract({ address: account, abi: sliceAccountAbi as Abi, functionName });
      const [c, p, cc, u, f, l, ic, b, pr] = await Promise.all([
        read('cumulativeRevenue'),
        read('paymentCount'),
        read('collectedCount'),
        read('uniquePayers'),
        read('firstRevenueAt'),
        read('lastRevenueAt'),
        read('issuerCredit'),
        read('activeBond'),
        read('project'),
      ]);
      return {
        cumulativeRevenue: c as bigint,
        paymentCount: BigInt(p as bigint),
        collectedCount: BigInt(cc as bigint),
        uniquePayers: BigInt(u as bigint),
        firstRevenueAt: BigInt(f as bigint),
        lastRevenueAt: BigInt(l as bigint),
        issuerCredit: ic as bigint,
        activeBond: b as Address,
        project: pr as Address,
      };
    },
  };
}
