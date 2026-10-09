// PumpLab demo traffic. Every wallet here is team-controlled; the two cohorts differ only in who funded them.
//   organic  funded by the deployer, unrelated to PumpLab's treasury -> counts as verified revenue
//   wash     funded by PumpLab's own issuer wallet                   -> the scorer must exclude it
//
//   pnpm tsx scripts/traffic-launchpad.ts organic 5     5 rounds of buys/sells by organic wallets
//   pnpm tsx scripts/traffic-launchpad.ts wash 5        a wash-trading burst from treasury-funded wallets
import os from 'node:os';
import path from 'node:path';
import { parseAbi, parseEther, parseUnits, type Address } from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';
import { account, chainId, publicClient, readDeployment, wallet, write } from './lib.ts';

const [mode = 'organic', roundsArg = '3'] = process.argv.slice(2);
if (mode !== 'organic' && mode !== 'wash') throw new Error('mode must be organic or wash');
const rounds = Number(roundsArg);
const WALLETS = Number(process.env.WALLETS ?? (mode === 'wash' ? 4 : 6));
const PER_WALLET = parseUnits(process.env.PER_WALLET_USDC ?? '0.5', 6);

const erc20 = parseAbi([
  'function transfer(address,uint256) returns (bool)',
  'function approve(address,uint256) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function mint(address,uint256)',
]);
const lab = parseAbi([
  'function buy(uint256 gross, uint256 minTokensOut, uint64 deadline) returns (uint256)',
  'function sell(uint256 amount, uint256 minUSDCOut, uint64 deadline) returns (uint256)',
  'function token() view returns (address)',
]);

const deployer = account('deployer', {
  fallbackFile: path.join(os.homedir(), '.zeitgeist/testnet-deployer.key'),
});
const treasury = account('pumplab-issuer');

async function topUp(funder: PrivateKeyAccount, to: Address, asset: Address) {
  // Gas always comes from the deployer; the USDC funder is what defines the cohort.
  // Monad bills the gas limit: a buy (which also sweeps the router) reserves ~0.09 MON at testnet prices.
  const have = await publicClient.getBalance({ address: to });
  if (have < parseEther('0.2')) {
    const hash = await wallet(deployer).sendTransaction({
      to,
      value: parseEther('0.25') - have,
      gas: 21_000n,
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }
  const bal = (await publicClient.readContract({
    address: asset,
    abi: erc20,
    functionName: 'balanceOf',
    args: [to],
  })) as bigint;
  if (bal >= PER_WALLET / 2n) return;
  if (chainId === 31337 && funder === deployer) await write(deployer, asset, erc20, 'mint', [to, PER_WALLET]);
  else await write(funder, asset, erc20, 'transfer', [to, PER_WALLET]);
}

async function main() {
  const d = readDeployment();
  const p = d.issuers.pumplab;
  if (!p?.source) throw new Error('Run scripts/setup-demo.ts first');
  const funder = mode === 'wash' ? treasury : deployer;
  if (mode === 'wash' && chainId === 31337)
    await write(deployer, d.asset, erc20, 'mint', [treasury.address, PER_WALLET * BigInt(WALLETS)]);
  const traders = Array.from({ length: WALLETS }, (_, i) => account(`${mode}-${i}`, { create: true }));
  for (const t of traders) await topUp(funder, t.address, d.asset);
  const token = (await publicClient.readContract({
    address: p.source,
    abi: lab,
    functionName: 'token',
  })) as Address;

  for (let r = 0; r < rounds; r++) {
    for (const t of traders) {
      // Deadlines come from chain time, not the local clock.
      const deadline = (await publicClient.getBlock()).timestamp + 600n;
      const spend = PER_WALLET / 5n;
      await write(t, d.asset, erc20, 'approve', [p.source, spend]);
      await write(t, p.source, lab, 'buy', [spend, 0n, deadline]);
      const held = (await publicClient.readContract({
        address: token,
        abi: erc20,
        functionName: 'balanceOf',
        args: [t.address],
      })) as bigint;
      // Wash wallets churn: sell straight back. Organic wallets keep most of their bag.
      const sellAmount = mode === 'wash' ? held : held / 4n;
      if (sellAmount > 0n) {
        await write(t, token, erc20, 'approve', [p.source, sellAmount]);
        await write(t, p.source, lab, 'sell', [sellAmount, 0n, deadline]);
      }
    }
    console.log(`  ${mode} round ${r + 1}/${rounds} done (${traders.length} wallets)`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
