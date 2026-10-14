// Lists a Bondrail revenue-claim token on Kuru (Monad testnet): a claim / USDC order book with an AMM vault
// seeded at ~1 USDC per claim. The claim's price is then a live market forecast of the business's
// remaining revenue to investors.
//
//   pnpm tsx scripts/kuru-market.ts [issuer=pumplab] [seedClaims=1]
//
// The Kuru SDK computes market parameters and reads vault state; transactions go through viem with
// explicit gas limits (the SDK's ethers v5 send path is rejected by Monad's RPC with
// "Signer had insufficient balance").
import { createRequire } from 'node:module';
import { ethers } from 'ethers';
import { decodeEventLog, parseAbi, parseUnits, type Abi, type Address } from 'viem';
import { ParamCreator, VaultParamFetcher } from '@kuru-labs/kuru-sdk';
import { account, chainId, publicClient, readDeployment, rpcUrl, saveDeployment, write } from '../../scripts/lib.ts';

const require = createRequire(import.meta.url);
const routerAbi = require('@kuru-labs/kuru-sdk/abi/Router.json').abi as Abi;
const vaultAbi = require('@kuru-labs/kuru-sdk/abi/Vault.json').abi as Abi;

// docs.kuru.io/contracts/Contract-addresses (Monad testnet)
const KURU_ROUTER: Address = '0x7EFbE105Ca7415dE98F96622173458ac1c054630';
const [issuerId = 'pumplab', seedArg = '1'] = process.argv.slice(2);

async function main() {
  if (chainId !== 10143) throw new Error('Kuru listing targets Monad testnet');
  const d = readDeployment();
  const issuer = d.issuers[issuerId] as (typeof d.issuers)[string] & {
    kuruMarket?: Address;
    kuruVault?: Address;
  };
  if (!issuer?.bond) throw new Error(`No bond for ${issuerId}`);
  const investor = account('investor'); // holds the claims, so it lists and seeds the market

  if (!issuer.kuruMarket) {
    // ~1 USDC per claim; prices up to 5; minimum order 0.01 claims; 1% ticks.
    const p = new ParamCreator().calculatePrecisions(1, 1, 5, 0.01, 100);
    const r = await write(investor, KURU_ROUTER, routerAbi, 'deployProxy', [
      0, // NO_NATIVE: both sides are ERC-20s
      issuer.bond,
      d.asset,
      BigInt(p.sizePrecision.toString()),
      Number(p.pricePrecision.toString()),
      Number(p.tickSize.toString()),
      BigInt(p.minSize.toString()),
      BigInt(p.maxSize.toString()),
      30n, // taker fee bps
      10n, // maker fee bps
      100n, // AMM spread bps
    ]);
    for (const log of r.logs) {
      try {
        const e = decodeEventLog({ abi: routerAbi, data: log.data, topics: log.topics });
        if (e.eventName === 'MarketRegistered') issuer.kuruMarket = (e.args as unknown as { market: Address }).market;
      } catch {}
    }
    if (!issuer.kuruMarket) throw new Error(`Market address not found in ${r.transactionHash}`);
    saveDeployment(d);
    console.log(`  Kuru market ${issuer.kuruMarket} (tx ${r.transactionHash})`);
  }

  const provider = new ethers.providers.JsonRpcProvider(rpcUrl, chainId);
  const { kuruAmmVault } = await VaultParamFetcher.getVaultParams(provider, issuer.kuruMarket);
  issuer.kuruVault = kuruAmmVault as Address;
  saveDeployment(d);
  console.log(`  AMM vault   ${kuruAmmVault}`);

  // Seed at 1:1 (both tokens use 6 decimals); accept up to 0.3% less quote consumed.
  const amount = parseUnits(seedArg, 6);
  const erc20 = parseAbi(['function approve(address,uint256) returns (bool)']);
  await write(investor, issuer.bond, erc20, 'approve', [kuruAmmVault, amount]);
  await write(investor, d.asset, erc20, 'approve', [kuruAmmVault, amount]);
  const r = await write(investor, issuer.kuruVault, vaultAbi, 'deposit', [
    amount,
    amount,
    (amount * 9970n) / 10_000n,
    investor.address,
  ]);
  console.log(`  Seeded ${seedArg} claims + ${seedArg} USDC (tx ${r.transactionHash})`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message.slice(0, 600) : e);
  process.exit(1);
});
