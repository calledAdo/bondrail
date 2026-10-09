// ERC-8004 identity and reputation for the Oracle Agent (Monad testnet registries).
//
//   pnpm tsx scripts/erc8004.ts register    registers the agent (owner = agent issuer), saves agentId
//   pnpm tsx scripts/erc8004.ts feedback    after a covenant default: posts negative feedback from an
//                                           independent reporter wallet (owners can't rate themselves)
import os from 'node:os';
import path from 'node:path';
import { decodeEventLog, keccak256, parseAbi, stringToHex } from 'viem';
import { account, artifact, publicClient, readDeployment, saveDeployment, write } from './lib.ts';

const IDENTITY = '0x8004A818BFB912233c491871b3d84c89A494BD9e';
const REPUTATION = '0x8004B663056A597Dffe9eCcC1965A193B7388713';
const identityAbi = parseAbi([
  'function register(string agentURI) returns (uint256 agentId)',
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

  if (cmd === 'feedback') {
    if (!agent.agentId) throw new Error('Register first');
    const defaultedAt = (await publicClient.readContract({
      address: agent.bond,
      abi: artifact('SliceBond').abi,
      functionName: 'defaultedAt',
    })) as bigint;
    if (defaultedAt === 0n) throw new Error('Bond has not defaulted; no feedback to post');
    // The deployer acts as an independent reporter: it neither owns nor operates the agent.
    const reporter = account('deployer', {
      fallbackFile: path.join(os.homedir(), '.zeitgeist/testnet-deployer.key'),
    });
    const evidence = `slice:covenant-default:${agent.bond}:${defaultedAt}`;
    const r = await write(reporter, REPUTATION, reputationAbi, 'giveFeedback', [
      BigInt(agent.agentId),
      -100n, // worst score: the agent diverted bond revenue
      0,
      'slice',
      'default',
      `${base}/api/oracle`,
      '',
      keccak256(stringToHex(evidence)),
    ]);
    console.log(`Posted default feedback for agentId ${agent.agentId} (tx ${r.transactionHash})`);
    return;
  }

  throw new Error('usage: erc8004.ts register | feedback');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message.slice(0, 400) : e);
  process.exit(1);
});
