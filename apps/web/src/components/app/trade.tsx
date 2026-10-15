'use client';
// Buy or sell a bond's claims on its Kuru market. The quote is the order itself, simulated against the current
// book (Kuru returns the amount out), so it includes the vault's price impact and the taker fee. The order is
// sent with a minimum output 1% under the quote; a quote older than 30 s is refreshed before sending.
import { useEffect, useState } from 'react';
import { useAccount, usePublicClient, useReadContracts, useWalletClient } from 'wagmi';
import { erc20Abi, formatUnits, parseUnits, type Address, type Hash } from 'viem';
import { ExternalLink } from 'lucide-react';
import { chain, safeNetwork } from '@/lib/wallet';
import type { BondView } from '@/lib/protocol';
import { cn } from '@/lib/cn';
import { confirmedIn, receiptTimed } from '@/lib/tx';
import { useKuruPrice } from '@/lib/kuru';

const orderbookAbi = [
  {
    type: 'function',
    name: 'getMarketParams',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { type: 'uint32', name: 'pricePrecision' },
      { type: 'uint96', name: 'sizePrecision' },
      { type: 'address', name: 'baseAsset' },
      { type: 'uint256', name: 'baseAssetDecimals' },
      { type: 'address', name: 'quoteAsset' },
      { type: 'uint256', name: 'quoteAssetDecimals' },
      { type: 'uint32', name: 'tickSize' },
      { type: 'uint96', name: 'minSize' },
      { type: 'uint96', name: 'maxSize' },
      { type: 'uint256', name: 'takerFeeBps' },
      { type: 'uint256', name: 'makerFeeBps' },
    ],
  },
  ...(['placeAndExecuteMarketBuy', 'placeAndExecuteMarketSell'] as const).map((name) => ({
    type: 'function' as const,
    name,
    stateMutability: 'payable' as const,
    inputs: [
      { type: 'uint96', name: 'size' },
      { type: 'uint256', name: 'minAmountOut' },
      { type: 'bool', name: 'isMargin' },
      { type: 'bool', name: 'isFillOrKill' },
    ],
    outputs: [{ type: 'uint256' }],
  })),
] as const;

const SLIPPAGE_BPS = 100n;
const QUOTE_TTL = 30_000;
const ZERO = '0x0000000000000000000000000000000000000000' as Address;

type Quote = { side: 'buy' | 'sell'; amount: string; out: bigint; at: number };

export function Trade({ b, initialSide = 'buy' }: { b: BondView; initialSide?: 'buy' | 'sell' }) {
  const market = b.kuru!.market as Address;
  const prices = useKuruPrice(market);
  const { address, chainId } = useAccount();
  const client = usePublicClient();
  const { data: wallet } = useWalletClient();
  const [side, setSide] = useState<'buy' | 'sell'>(initialSide);
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState<Quote>();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; error?: boolean; hash?: Hash }>();

  const me = address ?? ZERO;
  const reads = useReadContracts({
    contracts: [
      { address: market, abi: orderbookAbi, functionName: 'getMarketParams', chainId: chain.id },
      { address: b.asset.address, abi: erc20Abi, functionName: 'balanceOf', args: [me], chainId: chain.id },
      { address: b.address, abi: erc20Abi, functionName: 'balanceOf', args: [me], chainId: chain.id },
      { address: b.asset.address, abi: erc20Abi, functionName: 'allowance', args: [me, market], chainId: chain.id },
      { address: b.address, abi: erc20Abi, functionName: 'allowance', args: [me, market], chainId: chain.id },
    ],
    query: { refetchInterval: 10_000 },
  });
  const [params, cash, claims, cashAllowance, claimAllowance] = (reads.data ?? []).map((r) => r.result) as [
    readonly [number, bigint, Address, bigint, Address, bigint, number, bigint, bigint, bigint, bigint] | undefined,
    bigint?,
    bigint?,
    bigint?,
    bigint?,
  ];

  const d = b.asset.decimals; // claims share the asset's decimals
  const buy = side === 'buy';
  const valid = /^\d+(\.\d+)?$/.test(amount) && Number(amount) > 0;
  const spend = valid ? parseUnits(amount, d) : 0n;
  const balance = buy ? cash : claims;
  const allowance = buy ? cashAllowance : claimAllowance;
  const fee = params ? Number(params[9]) / 100 : 0.3;
  const bid = prices.bid ?? 0;
  const ask = prices.ask ?? 0;
  const ready = !!address && chainId === chain.id && safeNetwork && !busy && !!params;

  // Order size in the market's precision: buys are quote spent (price precision), sells are claims (size precision).
  const decimals = (p: NonNullable<typeof params>) => String(buy ? p[0] : p[1]).length - 1;
  const size = (p: NonNullable<typeof params>) => parseUnits(amount, decimals(p));

  async function simulate(minOut: bigint, at = size(params!)) {
    const { result, request } = await client!.simulateContract({
      account: address!,
      address: market,
      abi: orderbookAbi,
      functionName: buy ? 'placeAndExecuteMarketBuy' : 'placeAndExecuteMarketSell',
      args: [at, minOut, false, false],
    });
    return { out: result as unknown as bigint, request };
  }

  /** Largest order (in market precision) the book can fill now; Kuru reverts rather than partially filling. */
  async function maxFillable(upper: bigint) {
    let lo = 0n,
      hi = upper;
    for (let i = 0; i < 12 && hi - lo > 1n; i++) {
      const mid = (lo + hi) / 2n;
      const ok = await simulate(0n, mid).then((r) => r.out > 0n, () => false);
      if (ok) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  async function getQuote() {
    setStatus(undefined);
    try {
      const { out } = await simulate(0n);
      if (out === 0n) throw new Error('No liquidity for this size.');
      setQuote({ side, amount, out, at: Date.now() });
    } catch (e) {
      setQuote(undefined);
      // A revert while quoting is almost always depth: say how much the market can take instead.
      const max = await maxFillable(size(params!));
      setStatus({
        text:
          max > 0n
            ? `Not enough liquidity for this size: the market can fill at most ${formatUnits(max, decimals(params!))} ${buy ? b.asset.symbol : 'claims'} now.`
            : `The market can't fill this order now (${reason(e)}).`,
        error: true,
      });
    }
  }

  // Requote whenever the order changes (approval permitting).
  useEffect(() => {
    setQuote(undefined);
    if (!valid) return; // keeps the last receipt visible after a trade clears the amount
    if (ready && valid && (allowance ?? 0n) >= spend && (balance ?? 0n) >= spend) void getQuote();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side, amount, allowance, balance, ready]);

  async function run(label: string, fn: () => Promise<Hash>) {
    setBusy(true);
    setStatus({ text: 'Confirm in your wallet…' });
    try {
      const hash = await fn();
      setStatus({ text: 'Waiting for the receipt…', hash });
      const { receipt: r, ms } = await receiptTimed(client as never, hash);
      if (r.status !== 'success') throw new Error('The transaction reverted.');
      // Clear the order first: otherwise the balance refresh would requote it and replace this receipt.
      if (label !== 'Approve') setAmount('');
      setStatus({ text: `${label}: ${confirmedIn(ms)}.`, hash });
      await Promise.all([reads.refetch(), prices.refetch()]);
    } catch (e) {
      setStatus({ text: reason(e), error: true });
    } finally {
      setBusy(false);
    }
  }

  const approve = () =>
    run('Approve', () => wallet!.writeContract({ address: buy ? b.asset.address : b.address, abi: erc20Abi, functionName: 'approve', args: [market, spend], chain, account: address! }));

  const execute = () =>
    run(buy ? 'Buy' : 'Sell', async () => {
      // A stale quote is refreshed; the order carries a floor 1% under the fresh quote.
      let out = quote!.out;
      if (Date.now() - quote!.at > QUOTE_TTL) {
        out = (await simulate(0n)).out;
        setQuote({ side, amount, out, at: Date.now() });
      }
      const { request } = await simulate((out * (10_000n - SLIPPAGE_BPS)) / 10_000n);
      return wallet!.writeContract(request as never);
    });

  const current = quote && quote.side === side && quote.amount === amount ? quote : undefined;
  const outNum = current ? Number(formatUnits(current.out, d)) : 0;
  const avg = current && outNum > 0 ? (buy ? Number(amount) / outNum : outNum / Number(amount)) : 0;
  const best = buy ? ask : bid;
  const impact = avg && best ? Math.abs(avg - best) / best : 0;
  const n = (v?: bigint) => (v === undefined ? '–' : Number(formatUnits(v, d)).toLocaleString('en-US', { maximumFractionDigits: 4 }));

  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <dt className="text-xs text-foreground/60">Best bid</dt>
          <dd className="font-mono tabular">{bid ? bid.toFixed(4) : '–'}</dd>
        </div>
        <div>
          <dt className="text-xs text-foreground/60">Best ask</dt>
          <dd className="font-mono tabular">{ask ? ask.toFixed(4) : '–'}</dd>
        </div>
        <div>
          <dt className="text-xs text-foreground/60">Cash backing</dt>
          <dd className="font-mono tabular">{b.backingPerToken.toFixed(4)}</dd>
        </div>
      </dl>
      <p className="text-xs text-foreground/60">
        Prices in {b.asset.symbol} per claim. The market prices the remaining revenue rights; cash backing is only what a claim redeems for today.
      </p>

      <div className="grid grid-cols-2 gap-1 rounded-lg border border-foreground/15 p-1 text-sm">
        {(['buy', 'sell'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSide(s)}
            className={cn('h-8 rounded-md capitalize transition-colors', side === s ? 'bg-foreground text-background' : 'text-foreground/70 hover:bg-foreground/5')}
          >
            {s}
          </button>
        ))}
      </div>

      <label className="block space-y-1.5">
        <span className="flex justify-between text-xs text-foreground/60">
          <span>{buy ? `Spend (${b.asset.symbol})` : 'Sell (claims)'}</span>
          {address && <span>Balance {n(balance)}</span>}
        </span>
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          className="h-10 w-full rounded-lg border border-foreground/15 bg-transparent px-3 font-mono text-sm outline-none focus:border-foreground/40"
        />
      </label>

      {current && (
        <dl className="space-y-1.5 text-sm">
          {(
            [
              ['You receive', `${outNum.toLocaleString('en-US', { maximumFractionDigits: 6 })} ${buy ? 'claims' : b.asset.symbol}`],
              ['Average price', avg.toFixed(4)],
              ['Price impact', `${(impact * 100).toFixed(2)}%`],
              ['Taker fee', `${fee.toFixed(2)}% (included)`],
              ['Minimum received', `${Number(formatUnits((current.out * (10_000n - SLIPPAGE_BPS)) / 10_000n, d)).toLocaleString('en-US', { maximumFractionDigits: 6 })} (1% slippage)`],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4">
              <dt className="text-foreground/60">{k}</dt>
              <dd className={cn('font-mono tabular', k === 'Price impact' && impact > 0.05 && 'text-orange-500')}>{v}</dd>
            </div>
          ))}
        </dl>
      )}

      {!address ? (
        <p className="text-sm text-foreground/60">Connect a wallet to trade.</p>
      ) : valid && (balance ?? 0n) < spend ? (
        <p className="text-sm text-orange-500">Not enough {buy ? b.asset.symbol : 'claims'}.</p>
      ) : (allowance ?? 0n) < spend ? (
        <Action disabled={!ready || !valid} onClick={approve}>
          Approve {buy ? b.asset.symbol : 'claims'}
        </Action>
      ) : (
        <Action disabled={!ready || !current} onClick={execute}>
          {buy ? 'Buy claims' : 'Sell claims'}
        </Action>
      )}

      {status && (
        <p role={status.error ? 'alert' : 'status'} className={cn('text-sm', status.error ? 'text-red-500' : 'text-foreground/70')}>
          {status.text}{' '}
          {status.hash && chain.blockExplorers && (
            <a href={`${chain.blockExplorers.default.url}/tx/${status.hash}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline-offset-4 hover:underline">
              View <ExternalLink className="size-3" />
            </a>
          )}
        </p>
      )}
      <p className="text-xs text-foreground/50">
        Kuru market <span className="font-mono">{market.slice(0, 6)}…{market.slice(-4)}</span>. Testnet; small markets move a lot per trade.
      </p>
    </div>
  );
}

function Action({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-10 w-full rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors duration-300 hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function reason(e: unknown) {
  const m = e as { shortMessage?: string; message?: string; metaMessages?: string[] };
  const r = m.metaMessages?.find((x) => x.startsWith('Error:'))?.replace('Error: ', '');
  return (r ? `Reverted with ${r}` : m.shortMessage ?? m.message ?? 'Failed.').slice(0, 300);
}
