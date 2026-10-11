// A market order on a bond's Kuru claim/USDC market: quote by simulating the order itself, then execute with
// a minimum output 1% under the quote. Test activity from a team-controlled wallet (`kuru-trader`).
//
//   pnpm tsx demo/scripts/kuru-trade.ts buy 0.1      spend 0.1 USDC on claims
//   pnpm tsx demo/scripts/kuru-trade.ts sell 0.05    sell 0.05 claims for USDC
import { createRequire } from 'node:module';
import { erc20Abi, formatUnits, parseUnits, type Abi, type Address } from 'viem';
import { account, publicClient, readDeployment, write } from '../../scripts/lib.ts';

const require = createRequire(import.meta.url);
const ob = require('@kuru-labs/kuru-sdk/abi/OrderBook.json');
const orderbookAbi = (ob.abi ?? ob) as Abi;
const [side = 'buy', amountArg = '0.1', issuerId = 'pumplab'] = process.argv.slice(2);

async function main() {
  const d = readDeployment();
  const market = d.issuers[issuerId]?.kuruMarket as Address | undefined;
  if (!market) throw new Error(`No Kuru market for ${issuerId}`);
  const p = (await publicClient.readContract({ address: market, abi: orderbookAbi, functionName: 'getMarketParams' })) as readonly unknown[];
  const [pricePrecision, sizePrecision, base, baseDecimals, quote, quoteDecimals] = [
    p[0] as number, p[1] as bigint, p[2] as Address, Number(p[3]), p[4] as Address, Number(p[5]),
  ];
  const trader = account('kuru-trader', { create: true });
  const buy = side === 'buy';
  // Buys spend quote (scaled by pricePrecision); sells give base (scaled by sizePrecision).
  const spendToken = buy ? quote : base;
  const spend = parseUnits(amountArg, buy ? quoteDecimals : baseDecimals);
  const size = parseUnits(amountArg, String(buy ? pricePrecision : sizePrecision).length - 1);
  const balance = await publicClient.readContract({ address: spendToken, abi: erc20Abi, functionName: 'balanceOf', args: [trader.address] });
  if (balance < spend) throw new Error(`kuru-trader ${trader.address} holds ${formatUnits(balance, buy ? quoteDecimals : baseDecimals)}; fund it first`);
  await write(trader, spendToken, erc20Abi, 'approve', [market, spend]);

  const fn = buy ? 'placeAndExecuteMarketBuy' : 'placeAndExecuteMarketSell';
  const { result: quoted } = await publicClient.simulateContract({
    account: trader, address: market, abi: orderbookAbi, functionName: fn, args: [size, 0n, false, false],
  });
  const out = quoted as bigint;
  const outDecimals = buy ? baseDecimals : quoteDecimals;
  if (out === 0n) throw new Error('No liquidity for this size');
  const minOut = (out * 99n) / 100n;
  console.log(`  quote: ${amountArg} ${buy ? 'USDC' : 'claims'} -> ${formatUnits(out, outDecimals)} ${buy ? 'claims' : 'USDC'} (min ${formatUnits(minOut, outDecimals)})`);
  const r = await write(trader, market, orderbookAbi, fn, [size, minOut, false, false]);
  console.log(`  filled in tx ${r.transactionHash}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
