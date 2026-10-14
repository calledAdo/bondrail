// ERC-8004 identity and reputation for the Oracle Agent (Monad testnet registries).
//
//   pnpm tsx scripts/erc8004.ts register    registers the agent (owner = agent issuer), saves agentId
//   pnpm tsx scripts/erc8004.ts feedback    after a covenant default: posts negative feedback from an
//                                           independent reporter wallet (owners can't rate themselves)
//   pnpm tsx scripts/erc8004.ts repaid      after final cap settlement: positive feedback (no default)
// Explicit one-shot reporting: operators must check prior feedback before rerunning; no auto watcher.
import { bondrailAccountAbi, bondrailBondAbi } from '../../packages/sdk/src/abis.ts';
import os from 'node:os';
import path from 'node:path';
import { decodeEventLog, keccak256, parseAbi, stringToHex } from 'viem';
import { account, publicClient, readDeployment, saveDeployment, write } from '../../scripts/lib.ts';

const IDENTITY = '0x8004A818BFB912233c491871b3d84c89A494BD9e';
const REPUTATION = '0x8004B663056A597Dffe9eCcC1965A193B7388713';
const identityAbi = parseAbi([
  'function register(string agentURI) returns (uint256 agentId)',
  'function ownerOf(uint256 agentId) view returns (address)',
  'event Registered(uint256 indexed agentId, string agentURI, address indexed owner)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
]);
const reputationAbi = parseAbi([
  'function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)',
]);

async function main() {
  const [cmd] = process.argv.slice(2);
  const d = readDeployment();
  const agent = d.issuers.agent;
  if (!agent?.bond) throw new Error('Oracle Agent bond not set up');
  const base = agent.endpoint ? new URL(agent.endpoint).origin : 'https://slice-agent.vercel.app';

  if (cmd === 'register') {
    if (agent.agentId) return console.log(`Already registered: agentId ${agent.agentId}`);
    const r = await write(account('agent-issuer'), IDENTITY, identityAbi, 'register', [
      `${base}/.well-known/agent-registration.json`,
    ]);
    for (const log of r.logs) {
      try {
        const e = decodeEventLog({ abi: identityAbi, data: log.data, topics: log.topics });
        if (e.eventName === 'Transfer' || e.eventName === 'Registered')
          agent.agentId = String(
            'agentId' in e.args ? e.args.agentId : (e.args as { tokenId: bigint }).tokenId,
          );
      } catch {}
    }
    if (!agent.agentId) throw new Error(`agentId not found in ${r.transactionHash}`);
    saveDeployment(d);
    console.log(`Registered Oracle Agent as agentId ${agent.agentId} (tx ${r.transactionHash})`);
    return;
  }

  if (cmd === 'feedback' || cmd === 'repaid') {
    if (!agent.agentId) throw new Error('Register first');
    const blockNumber = await publicClient.getBlockNumber();
    const bondRead = { address: agent.bond, abi: bondrailBondAbi, blockNumber } as const;
    const [bondAccount, defaultedAt, phase, closeReason, collected, cap, closedAt, owner] = await Promise.all([
      publicClient.readContract({ ...bondRead, functionName: 'account' }),
      publicClient.readContract({ ...bondRead, functionName: 'defaultedAt' }),
      publicClient.readContract({ ...bondRead, functionName: 'phase' }),
      publicClient.readContract({ ...bondRead, functionName: 'closeReason' }),
      publicClient.readContract({ ...bondRead, functionName: 'totalRevenueCollected' }),
      publicClient.readContract({ ...bondRead, functionName: 'effectiveRevenueCap' }),
      publicClient.readContract({ ...bondRead, functionName: 'collectionClosedAt' }),
      publicClient.readContract({ address: IDENTITY, abi: identityAbi, functionName: 'ownerOf', args: [BigInt(agent.agentId)], blockNumber }),
    ]);
    const issuer = await publicClient.readContract({ address: bondAccount, abi: bondrailAccountAbi, functionName: 'issuer', blockNumber });
    if (bondAccount.toLowerCase() !== agent.account.toLowerCase() || issuer.toLowerCase() !== owner.toLowerCase())
      throw new Error('Registered agent owner does not match this bond account issuer');
    const repaid = cmd === 'repaid';
    if (repaid && (phase !== 3 || closeReason !== 1 || defaultedAt !== 0n || cap === 0n || collected !== cap))
      throw new Error('Positive feedback requires final Closed, full effective cap and no default');
    if (!repaid && defaultedAt === 0n) throw new Error('Bond has not defaulted; no feedback to post');
    // The deployer acts as an independent reporter: it neither owns nor operates the agent.
    const reporter = account('deployer', {
      fallbackFile: path.join(os.homedir(), '.zeitgeist/testnet-deployer.key'),
    });
    const evidence = repaid ? `bondrail:fully-repaid:${agent.bond}:${closedAt}:${collected}:${cap}` : `bondrail:covenant-default:${agent.bond}:${defaultedAt}`;
    const r = await write(reporter, REPUTATION, reputationAbi, 'giveFeedback', [
      BigInt(agent.agentId),
      repaid ? 100n : -100n,
      0,
      'bondrail',
      repaid ? 'fully-repaid' : 'default',
      `${base}/api/oracle`,
      '',
      keccak256(stringToHex(evidence)),
    ]);
    console.log(`Posted ${repaid ? 'fully repaid' : 'default'} feedback for agentId ${agent.agentId} (tx ${r.transactionHash})`);
    return;
  }

  throw new Error('usage: erc8004.ts register | feedback | repaid');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message.slice(0, 400) : e);
  process.exit(1);
});
