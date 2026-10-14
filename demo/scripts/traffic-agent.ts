// Oracle Agent demo traffic: payer wallets call the paid x402 API at random intervals.
// Payers only sign EIP-3009 USDC authorizations; the x402 facilitator settles on-chain and pays the
// gas, so these wallets need test USDC but no MON. Every payer here is team-controlled.
// Payers are guarded buyers (@bondrail/sdk/x402-guard): they refuse any offer whose payTo is not the
// BondrailAccount the agent publishes in /.well-known/bondrail.json and the factory confirms on-chain.
//
//   AGENT_URL=https://<agent>/api/oracle pnpm tsx scripts/traffic-agent.ts [calls=20] [payers=5]
import { x402Client, wrapFetchWithPayment } from '@x402/fetch';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { parseAbi, parseUnits } from 'viem';
import os from 'node:os';
import path from 'node:path';
import { account, publicClient, readDeployment, write } from '../../scripts/lib.ts';
import { isBondrailAccount, pinFromBond, bondrailGuard } from '../../packages/sdk/src/x402-guard.ts';

const [callsArg = '20', payersArg = '5'] = process.argv.slice(2);
const AGENT_URL = process.env.AGENT_URL ?? readDeployment().issuers.agent?.endpoint?.split('?')[0];
if (!AGENT_URL) throw new Error('Set AGENT_URL to the deployed /api/oracle endpoint');
const PER_PAYER = parseUnits(process.env.PER_PAYER_USDC ?? '0.2', 6); // 20 calls at $0.01

const QUESTIONS = [
  'What is a revenue-based financing bond, in two sentences?',
  'Why does fast finality matter for micropayments?',
  'Explain EIP-3009 transferWithAuthorization briefly.',
  'What is a bonding curve?',
  'Name one risk of lending against future revenue.',
  'What does an x402 Payment Required response contain?',
];

const erc20 = parseAbi([
  'function transfer(address,uint256) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
]);

async function main() {
  const d = readDeployment();
  // Pin the agent's financed account from its bond on-chain, so a changed manifest can't redirect payers.
  const bond = d.issuers.agent?.bond;
  const pins = bond ? { [new URL(AGENT_URL!).origin]: await pinFromBond(publicClient as never, bond) } : undefined;
  const deployer = account('deployer', {
    fallbackFile: path.join(os.homedir(), '.zeitgeist/testnet-deployer.key'),
  });
  if (!Number.isSafeInteger(Number(callsArg)) || Number(callsArg) < 1 || !Number.isSafeInteger(Number(payersArg)) || Number(payersArg) < 1) throw new Error('Positive integer calls/payers required');
  const payers = Array.from({ length: Number(payersArg) }, (_, i) => account(`payer-${i}`, { create: true }));
  for (const p of payers) {
    const bal = (await publicClient.readContract({
      address: d.asset,
      abi: erc20,
      functionName: 'balanceOf',
      args: [p.address],
    })) as bigint;
    if (bal < PER_PAYER / 4n) await write(deployer, d.asset, erc20, 'transfer', [p.address, PER_PAYER]);
  }
  const fetchers = payers.map((p) => {
    const client = new x402Client();
    registerExactEvmScheme(client, { signer: p });
    return wrapFetchWithPayment(
      bondrailGuard(fetch, { verifyAccount: isBondrailAccount(publicClient, d.factory), pin: pins }),
      client,
    );
  });

  for (let i = 0; i < Number(callsArg); i++) {
    const n = i % payers.length;
    const q = QUESTIONS[Math.floor(Math.random() * QUESTIONS.length)];
    const url = `${AGENT_URL}?question=${encodeURIComponent(q)}`;
    const t0 = Date.now();
    try {
      const r = await fetchers[n](url);
      const body = (await r.json().catch(() => ({}))) as {
        answer?: string;
        payment?: { transaction?: string };
      };
      if (r.status !== 200 || !body.payment?.transaction) throw new Error(`Payment failed: HTTP ${r.status}`);
      console.log(
        `  call ${i + 1}: payer-${n} HTTP ${r.status} in ${Date.now() - t0} ms` +
          (body.payment?.transaction ? ` tx ${body.payment.transaction}` : ''),
      );
    } catch (e) {
      if (process.env.TRAFFIC_STRICT === '1') throw e;
      console.log(`  call ${i + 1}: payer-${n} failed: ${e instanceof Error ? e.message.slice(0, 120) : e}`);
    }
    await new Promise((res) => setTimeout(res, Number(process.env.TRAFFIC_DELAY_MS ?? (1500 + Math.random() * 3000))));
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
