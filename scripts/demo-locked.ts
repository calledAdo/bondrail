// The Locked-adapter moment: PumpLab Classic's owner tries to redirect launchpad fees to a private wallet.
// FeeGuard owns the launchpad and refuses the call; a harmless admin change still goes through.
//
//   pnpm tsx scripts/demo-locked.ts
import { BaseError, encodeFunctionData, parseAbi } from 'viem';
import { account, artifact, publicClient, readDeployment, write } from './lib.ts';

async function main() {
  const d = readDeployment();
  const p = d.issuers.classic!;
  const owner = account('classic-issuer');
  const guard = artifact('FeeGuard').abi;
  const lab = parseAbi([
    'function setFeeRecipient(address)',
    'function setMaxNameLength(uint16)',
    'function feeRecipient() view returns (address)',
    'function maxNameLength() view returns (uint16)',
  ]);

  console.log(
    `Fee recipient today: ${await publicClient.readContract({ address: p.source!, abi: lab, functionName: 'feeRecipient' })} (the SliceAccount)`,
  );
  console.log('1. Owner calls guard.execute(setFeeRecipient(ownerWallet))');
  try {
    await publicClient.simulateContract({
      account: owner,
      address: p.guard!,
      abi: guard,
      functionName: 'execute',
      args: [encodeFunctionData({ abi: lab, functionName: 'setFeeRecipient', args: [owner.address] })],
    });
    console.log('   UNEXPECTED: call would succeed');
  } catch (e) {
    const err = (e as BaseError).walk?.((x) => 'data' in (x as object)) as { data?: { errorName?: string } } | undefined;
    console.log(`   Reverted: FeeGuard.${err?.data?.errorName ?? 'execute'}() (selector not allowed while the bond is live)`);
  }
  console.log('2. Owner calls guard.execute(setMaxNameLength(48)), an allowed setting');
  const r = await write(owner, p.guard!, guard, 'execute', [
    encodeFunctionData({ abi: lab, functionName: 'setMaxNameLength', args: [48] }),
  ]);
  console.log(
    `   OK in tx ${r.transactionHash}; maxNameLength = ${await publicClient.readContract({ address: p.source!, abi: lab, functionName: 'maxNameLength' })}`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
