// Launchpad demo traffic. Every wallet here is team-controlled; the two cohorts differ only in who funded them.
//   organic  funded by the deployer, unrelated to the business's treasury -> verified revenue
//   wash     funded by the business's own issuer wallet                   -> the scorer must exclude it
//
//   pnpm tsx scripts/traffic-launchpad.ts pumplab organic 2     Native PumpLab (traders approve the BondrailAccount)
//   pnpm tsx scripts/traffic-launchpad.ts pumplab wash 1
import os from 'node:os';
import path from 'node:path';
import { maxUint256, parseAbi, parseEther, parseUnits, type Address } from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';
import { account, chainId, publicClient, readDeployment, wallet, write } from '../../scripts/lib.ts';

const [issuerId = 'pumplab', mode = 'organic', roundsArg = '1'] = process.argv.slice(2);
if (mode !== 'organic' && mode !== 'wash') throw new Error('mode must be organic or wash');
const rounds = Number(roundsArg);
const WALLETS = Number(process.env.WALLETS ?? (mode === 'wash' ? 2 : 3));
const PER_WALLET = parseUnits(process.env.PER_WALLET_USDC ?? '0.3', 6);

const erc20 = parseAbi([
  'function transfer(address,uint256) returns (bool)',
  'function approve(address,uint256) returns (bool)',
  'function allowance(address,address) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function mint(address,uint256)',
]);
const lab = parseAbi([
  'function buy(uint256 gross, uint256 minTokensOut, uint64 deadline) returns (uint256)',
  'function sell(uint256 amount, uint256 minUSDCOut, uint64 deadline) returns (uint256)',
  'function token() view returns (address)',
]);

const deployer = account('deployer', { fallbackFile: path.join(os.homedir(), '.zeitgeist/testnet-deployer.key') });

async function topUp(funder: PrivateKeyAccount, to: Address, asset: Address) {
  // Gas always comes from the deployer; the USDC funder is what defines the cohort.
  // Monad bills the gas limit: a launchpad trade reserves roughly 0.05-0.1 MON at testnet prices.
  const have = await publicClient.getBalance({ address: to });
  if (have < parseEther('0.2')) {
    const hash = await wallet(deployer).sendTransaction({ to, value: parseEther('0.3') - have, gas: 21_000n });
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

async function approveOnce(owner: PrivateKeyAccount, token: Address, spender: Address) {
  const a = (await publicClient.readContract({
    address: token,
    abi: erc20,
    functionName: 'allowance',
    args: [owner.address, spender],
  })) as bigint;
  if (a < maxUint256 / 2n) await write(owner, token, erc20, 'approve', [spender, maxUint256]);
}

async function main() {
  const d = readDeployment();
  const rec = d.issuers[issuerId];
  if (!rec?.source) throw new Error(`Run scripts/setup-demo.ts ${issuerId} first`);
  const treasury = account(`${issuerId}-issuer`);
  const funder = mode === 'wash' ? treasury : deployer;
  if (mode === 'wash' && chainId === 31337)
    await write(deployer, d.asset, erc20, 'mint', [treasury.address, PER_WALLET * BigInt(WALLETS)]);
  const traders = Array.from({ length: WALLETS }, (_, i) => account(`${issuerId}-${mode}-${i}`, { create: true }));
  const token = (await publicClient.readContract({ address: rec.source, abi: lab, functionName: 'token' })) as Address;
  // The BondrailAccount pulls every USDC payment (and the sell fee), so traders approve it, not the launchpad.
  const usdcSpender = rec.account;
  for (const t of traders) {
    await topUp(funder, t.address, d.asset);
    await approveOnce(t, d.asset, usdcSpender);
    await approveOnce(t, token, rec.source);
  }

  for (let r = 0; r < rounds; r++) {
    for (const t of traders) {
      const deadline = (await publicClient.getBlock()).timestamp + 600n; // chain time, not the local clock
      await write(t, rec.source, lab, 'buy', [PER_WALLET / 5n, 0n, deadline]);
      const held = (await publicClient.readContract({
        address: token,
        abi: erc20,
        functionName: 'balanceOf',
        args: [t.address],
      })) as bigint;
      // Wash wallets churn: sell straight back. Organic wallets keep most of their bag.
      const sellAmount = mode === 'wash' ? held : held / 4n;
      if (sellAmount > 0n) await write(t, rec.source, lab, 'sell', [sellAmount, 0n, deadline]);
    }
    console.log(`  ${rec.name} ${mode} round ${r + 1}/${rounds} (${traders.length} wallets)`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
