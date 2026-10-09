// The Watched-adapter climax, in one command. IRREVERSIBLE for the bond: it defaults and the issuer's
// stake moves to bondholders.
//
//   1. The agent operator points the x402 payTo at their own wallet (agent admin API).
//   2. Chainlink CRE reports the violation in two adjacent 30 s epochs; the covenant defaults the bond.
//   3. An independent reporter posts negative ERC-8004 feedback for the agent.
//
//   pnpm tsx scripts/demo-default.ts --yes          run it
//   pnpm tsx scripts/demo-default.ts restore        point payTo back at the router (bond stays defaulted)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { artifact, KEY_DIR, publicClient, readDeployment, ROOT } from './lib.ts';

const d = readDeployment();
const agent = d.issuers.agent!;
const AGENT = new URL(agent.endpoint!).origin;
const ADMIN = fs.readFileSync(path.join(KEY_DIR, 'agent-admin.token'), 'utf8').trim();
const bondAbi = artifact('SliceBond').abi;

async function setPayTo(payTo: string) {
  const cur = (await (await fetch(`${AGENT}/api/config`, { cache: 'no-store' })).json()) as {
    revision: number;
  };
  const r = await fetch(`${AGENT}/api/admin/config`, {
    method: 'POST',
    headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ revision: cur.revision, payTo }),
  });
  if (!r.ok) throw new Error(`payTo update failed: HTTP ${r.status}`);
  console.log(`  payTo -> ${payTo}`);
}

function creReport() {
  const out = execFileSync(
    'cre',
    [
      'workflow',
      'simulate',
      'slice-covenant',
      '--target',
      'testnet',
      '--non-interactive',
      '--trigger-index',
      '0',
      '--broadcast',
    ],
    {
      cwd: path.join(ROOT, 'cre'),
      env: { ...process.env, PATH: `${os.homedir()}/.cre/bin:${os.homedir()}/.bun/bin:${process.env.PATH}` },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const tx = /SLICE_REPORT_TX=(0x[0-9a-f]{64})/.exec(out)?.[1];
  console.log(`  CRE report ${tx ?? '(no report)'}`);
}

const nextEpoch = () =>
  new Promise((r) => setTimeout(r, (30 - (Math.floor(Date.now() / 1000) % 30) + 2) * 1000));

async function main() {
  const [arg] = process.argv.slice(2);
  if (arg === 'restore') return setPayTo(agent.router);
  if (arg !== '--yes') throw new Error('This defaults the Oracle Agent bond permanently. Re-run with --yes.');

  console.log('1. Operator diverts the x402 payTo to their own wallet');
  await setPayTo(agent.issuer);
  console.log('2. Chainlink CRE observes the violation in two adjacent epochs');
  await nextEpoch();
  creReport();
  await nextEpoch();
  creReport();
  const defaultedAt = (await publicClient.readContract({
    address: agent.bond!,
    abi: bondAbi,
    functionName: 'defaultedAt',
  })) as bigint;
  const pool = (await publicClient.readContract({
    address: agent.bond!,
    abi: bondAbi,
    functionName: 'pool',
  })) as bigint;
  console.log(
    defaultedAt > 0n
      ? `  DEFAULTED at ${defaultedAt}; bondholder pool now ${Number(pool) / 1e6} USDC`
      : '  not defaulted yet (epochs not adjacent?)',
  );
  if (defaultedAt > 0n) {
    console.log('3. ERC-8004 feedback');
    execFileSync('npx', ['tsx', 'scripts/erc8004.ts', 'feedback'], { cwd: ROOT, stdio: 'inherit' });
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
