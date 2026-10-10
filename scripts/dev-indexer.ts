// LOCAL ONLY: a stand-in for the Envio indexer on anvil (Envio needs Docker). Answers the web app's
// GraphQL queries by reading factory, account, bond and covenant events and state straight from the chain
// on every request. Not a GraphQL server: it returns every entity the app asks for, whatever the query.
//
//   SLICE_CHAIN_ID=31337 pnpm tsx scripts/dev-indexer.ts        listens on http://127.0.0.1:8546
import http from 'node:http';
import { parseAbiItem, type Address } from 'viem';
import { artifact, chainId, publicClient, readDeployment } from './lib.ts';

if (chainId !== 31337) throw new Error('dev-indexer is for the local chain only');
const d = readDeployment();
const factoryAbi = artifact('SliceFactory').abi;
const accountAbi = artifact('SliceAccount').abi;
const bondAbi = artifact('SliceBond').abi;
const low = (a: string) => a.toLowerCase();
const DAY = 86_400;

const ev = {
  account: parseAbiItem('event AccountCreated(address indexed issuer, address indexed account, address indexed asset)'),
  bond: parseAbiItem(
    'event BondCreated(address indexed issuer, address indexed account, address indexed bond, uint8 adapter, bytes32 policyHash, bytes32 termsHash)',
  ),
  revenue: parseAbiItem(
    'event Revenue(address indexed bond, address indexed payer, uint256 amount, uint256 toBond, uint256 toIssuer, bool collected)',
  ),
  observation: parseAbiItem(
    'event ObservationAccepted(address indexed bond, uint64 indexed epoch, uint8 result, uint64 observedAt, bytes32 evidenceHash, bytes32 digest)',
  ),
};

async function snapshot() {
  const logs = <T extends (typeof ev)[keyof typeof ev]>(event: T, address?: Address | Address[]) =>
    publicClient.getLogs({ address, event, fromBlock: 0n, toBlock: 'latest' } as never) as Promise<any[]>;
  const read = (address: Address, abi: any, functionName: string, args: unknown[] = []) =>
    publicClient.readContract({ address, abi, functionName, args }) as Promise<any>;
  const accounts = await logs(ev.account, d.factory);
  const bonds = await logs(ev.bond, d.factory);
  const revenue = accounts.length ? await logs(ev.revenue, accounts.map((a) => a.args.account)) : [];
  const times = new Map<bigint, number>();
  const ts = async (block: bigint) => {
    if (!times.has(block)) times.set(block, Number((await publicClient.getBlock({ blockNumber: block })).timestamp));
    return times.get(block)!;
  };

  const Issuer = await Promise.all(
    accounts.map(async (a) => {
      const id = low(a.args.account);
      const [project, activeBond, cumulative, payments, first, volume] = await Promise.all([
        read(a.args.account, accountAbi, 'project'),
        read(a.args.account, accountAbi, 'activeBond'),
        read(a.args.account, accountAbi, 'cumulativeRevenue'),
        read(a.args.account, accountAbi, 'paymentCount'),
        read(a.args.account, accountAbi, 'firstRevenueAt'),
        read(a.args.account, accountAbi, 'cumulativeVolume'),
      ]);
      const bound = !/^0x0{40}$/i.test(project);
      const bond = bonds.find((b) => low(b.args.account) === id);
      const mine = revenue.filter((r) => low(r.address) === id);
      return {
        id,
        issuer: low(a.args.issuer),
        asset: low(a.args.asset),
        tier: bound ? 0 : bond ? Number(bond.args.adapter) : null,
        project: bound ? low(project) : null,
        projectApproved: bound ? await read(d.factory, factoryAbi, 'nativeApproved', [project]) : null,
        activeBond: /^0x0{40}$/i.test(activeBond) ? null : low(activeBond),
        grossRevenue: String(cumulative),
        volume: String(volume),
        toInvestors: String(mine.reduce((s, r) => s + r.args.toBond, 0n)),
        payments: Number(payments),
        firstRevenueAt: Number(first) ? String(first) : null,
      };
    }),
  );

  const Bond = await Promise.all(
    bonds.map(async (b) => {
      const at = b.args.bond as Address;
      const [phase, escrow, released, undrawn, recovery, collected, stakeRec, pool, supply, cap, defaulted] = await Promise.all(
        ['phase', 'fundingEscrow', 'releasedPrincipal', 'undrawnPrincipal', 'principalRecovery', 'totalRevenueCollected', 'stakeRecovery', 'pool', 'totalSupply', 'effectiveRevenueCap', 'defaultedAt'].map(
          (f) => read(at, bondAbi, f),
        ),
      );
      return {
        id: low(at),
        account: low(b.args.account),
        adapter: Number(b.args.adapter),
        phase: Number(phase),
        // Funding: the escrow; afterwards the full raise (escrow is cleared at activation).
        raised: String(Number(phase) === 0 || Number(phase) === 4 ? escrow : (released as bigint) + (undrawn as bigint) + (recovery as bigint)),
        released: String(released),
        undrawn: String(undrawn),
        principalRecovery: String(recovery),
        revenueCollected: String(collected),
        stakeRecovery: String(stakeRec),
        pool: String(pool),
        totalSupply: String(supply),
        effectiveCap: String(cap),
        defaulted: Number(defaulted) !== 0,
        createdAt: String(await ts(b.blockNumber)),
      };
    }),
  );

  const Payment = [];
  const daily = new Map<string, { account: string; day: number; gross: bigint; verified: bigint }>();
  for (const r of revenue) {
    const t = await ts(r.blockNumber);
    const account = low(r.address);
    Payment.push({
      account,
      payer: low(r.args.payer),
      amount: String(r.args.amount),
      related: !r.args.collected,
      reasons: r.args.collected ? [] : ['unclassified_inflow'],
      source: r.args.collected ? 'native' : 'transfer',
      timestamp: String(t),
      txHash: r.transactionHash,
    });
    const key = `${account}-${Math.floor(t / DAY)}`;
    const row = daily.get(key) ?? { account, day: Math.floor(t / DAY), gross: 0n, verified: 0n };
    row.gross += r.args.amount;
    if (r.args.collected) row.verified += r.args.amount;
    daily.set(key, row);
  }
  const checks = await logs(ev.observation, d.covenant);
  return {
    Issuer,
    Bond: Bond.sort((a, b) => Number(b.createdAt) - Number(a.createdAt)),
    DailyRevenue: [...daily.values()].map((x) => ({ ...x, gross: String(x.gross), verified: String(x.verified) })),
    Payment: Payment.reverse(),
    CovenantCheck: await Promise.all(
      checks.map(async (c) => ({ bond: low(c.args.bond), result: Number(c.args.result), observedAt: String(c.args.observedAt), txHash: c.transactionHash })),
    ),
  };
}

http
  .createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    if (req.method === 'OPTIONS') return void res.end();
    try {
      const data = await snapshot();
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ data }));
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ errors: [{ message: (e as Error).message }] }));
    }
  })
  .listen(8546, '127.0.0.1', () => console.log('dev indexer on http://127.0.0.1:8546 (local chain)'));
