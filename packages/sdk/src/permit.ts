// EIP-2612 permit for a Native payment: the payer signs once, the project's SliceAccount pulls exactly
// `value` in the same transaction (via SliceEarner._collectWithPermit). No standing approval is left.
import { parseSignature, type Account, type Address, type Chain, type PublicClient, type Transport, type WalletClient } from 'viem';

const erc20PermitAbi = [
  { type: 'function', name: 'nonces', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'version', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
] as const;

export async function signAccountPermit(o: {
  publicClient: PublicClient;
  walletClient: WalletClient<Transport, Chain, Account>;
  /** The payment token (e.g. USDC). */
  asset: Address;
  /** The project's SliceAccount: the spender that will pull the payment. */
  account: Address;
  value: bigint;
  deadline: bigint;
}): Promise<{ deadline: bigint; v: number; r: `0x${string}`; s: `0x${string}` }> {
  const owner = o.walletClient.account.address;
  const [nonce, name, version] = await Promise.all([
    o.publicClient.readContract({ address: o.asset, abi: erc20PermitAbi, functionName: 'nonces', args: [owner] }),
    o.publicClient.readContract({ address: o.asset, abi: erc20PermitAbi, functionName: 'name' }),
    o.publicClient
      .readContract({ address: o.asset, abi: erc20PermitAbi, functionName: 'version' })
      .catch(() => '1'),
  ]);
  const signature = await o.walletClient.signTypedData({
    domain: { name, version, chainId: o.walletClient.chain.id, verifyingContract: o.asset },
    types: {
      Permit: [
        { name: 'owner', type: 'address' },
        { name: 'spender', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'Permit',
    message: { owner, spender: o.account, value: o.value, nonce, deadline: o.deadline },
  });
  const { v, r, s, yParity } = parseSignature(signature);
  return { deadline: o.deadline, v: Number(v ?? BigInt(27 + (yParity ?? 0))), r, s };
}
