// LOCAL ONLY: a stand-in for the Envio indexer on anvil (Envio needs Docker). Answers the web app's
// GraphQL queries by reading factory, account, bond and covenant events and state straight from the chain
// on every request. Not a GraphQL server: it returns every entity the app asks for, whatever the query.
//
//   BONDRAIL_CHAIN_ID=31337 pnpm tsx scripts/dev-indexer.ts        listens on http://127.0.0.1:8546
import http from 'node:http';
import { localVaultIndex } from './local-vault-index.ts';
import { parseAbiItem, type Address } from 'viem';
import { artifact, chainId, publicClient, readDeployment } from './lib.ts';

if (chainId !== 31337) throw new Error('dev-indexer is for the local chain only');
const d = readDeployment();
const factoryAbi = artifact('BondrailFactory').abi;
const accountAbi = artifact('BondrailAccount').abi;
const bondAbi = artifact('BondrailBond').abi;
const low = (a: string) => a.toLowerCase();
const DAY = 86_400;

const ev = {
  settled: parseAbiItem('event Settled(address indexed payer,uint256 value,bytes32 indexed nonce)'),
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
  const settled = accounts.length ? await logs(ev.settled, accounts.map((a) => a.args.account)) : [];
  const x402 = new Set(settled.map(s => `${low(s.address)}-${s.transactionHash}`));
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
        chainId,
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
        triggered: await read(at, bondAbi, 'triggered'),
        createdAt: String(await ts(b.blockNumber)),
      };
    }),
  );

  const Payment = [];
  const daily = new Map<string, { account: string; day: number; gross: bigint; verified: bigint; x402: bigint }>();
  const payerTotals = new Map<string, { account: string; payer: string; amount: bigint; payments: number; related: boolean; reasons: string[]; source: string }>();
  for (const r of revenue) {
    const t = await ts(r.blockNumber);
    const account = low(r.address);
    const source = x402.has(`${account}-${r.transactionHash}`) ? 'x402' : r.args.collected ? 'native' : 'transfer';
    Payment.push({
      account,
      payer: low(r.args.payer),
      amount: String(r.args.amount),
      related: !r.args.collected,
      reasons: r.args.collected ? [] : ['unclassified_inflow'],
      source,
      timestamp: String(t),
      txHash: r.transactionHash,
    });
    const key = `${account}-${Math.floor(t / DAY)}`;
    const row = daily.get(key) ?? { account, day: Math.floor(t / DAY), gross: 0n, verified: 0n, x402: 0n };
    row.gross += r.args.amount;
    if (r.args.collected) row.verified += r.args.amount;
    if (source === 'x402') row.x402 += r.args.amount;
    daily.set(key, row);
    const payer = low(r.args.payer);
    const pt = payerTotals.get(`${account}-${payer}`) ?? {
      account, payer, amount: 0n, payments: 0, related: false, reasons: [] as string[], source,
    };
    pt.amount += r.args.amount;
    pt.payments += 1;
    if (!r.args.collected) { pt.related = true; if (!pt.reasons.includes('unclassified_inflow')) pt.reasons.push('unclassified_inflow'); }
    payerTotals.set(`${account}-${payer}`, pt);
  }
  const checks = await logs(ev.observation, d.covenant);
  return {
    ...await localVaultIndex(publicClient, d),
    Issuer,
    Bond: Bond.sort((a, b) => Number(b.createdAt) - Number(a.createdAt)),
    DailyRevenue: [...daily.values()].map((x) => ({ ...x, id: `${x.account}-${x.day}`, gross: String(x.gross), verified: String(x.verified), x402: String(x.x402) })),
    PayerTotal: [...payerTotals.values()].map((x) => ({ ...x, id: `${x.account}-${x.payer}`, amount: String(x.amount) })),
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
    // Readiness must not queue a full chain scan on every probe. Data queries below still
    // read real state and expose RPC failures to the caller.
    if (req.method === 'GET' && req.url === '/health') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ status: 'ready', chainId }));
      return;
    }
    try {
      const data = await snapshot();
      // The attester uses account-scoped keyset queries. Implement just those variables;
      // this remains a local app adapter, not a general GraphQL implementation.
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 16384) throw new Error('Request too large'); }
      const { variables: v = {} } = body ? JSON.parse(body) : {};
      if (v.holder) data.VaultPosition = data.VaultPosition.filter(p => p.holder === low(v.holder));
      if (v.vaults) data.VaultDailySnapshot = data.VaultDailySnapshot.filter(p => v.vaults.map(low).includes(p.vault) && p.day >= (v.day ?? 0));
      if (v.account) {
        const target = low(v.account);
        data.Issuer = data.Issuer.filter(i => i.id === target && (!v.chain || v.chain === chainId));
        data.PayerTotal = data.PayerTotal.filter(p => p.account === target && p.id > (v.cursor ?? '')).sort((a, b) => a.id.localeCompare(b.id)).slice(0, 1000);
        data.DailyRevenue = data.DailyRevenue.filter(r => r.account === target && r.day >= (v.from ?? 0) && r.day <= (v.to ?? Infinity));
      }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ data }));
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ errors: [{ message: (e as Error).message }] }));
    }
  })
  .listen(Number(process.env.INDEXER_PORT ?? 8546), '127.0.0.1', () => console.log('dev indexer ready (local chain)'));
