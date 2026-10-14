import { createConfig, http } from 'wagmi';
import { injected, mock } from 'wagmi/connectors';
import { passkey } from './passkey-connector';
import { defineChain, isAddress, type Address } from 'viem';
const configuredId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 10143);
export const safeNetwork = configuredId === 10143 || configuredId === 31337;
export const chain = defineChain({
  id: configuredId === 31337 ? 31337 : 10143,
  name: configuredId === 31337 ? 'Local development' : 'Monad testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        process.env.NEXT_PUBLIC_RPC_URL ||
          (configuredId === 31337 ? 'http://127.0.0.1:8545' : 'https://testnet-rpc.monad.xyz'),
      ],
    },
  },
  // Multicall3 lets wagmi/viem fold many reads into one eth_call (Monad's public RPC rate-limits bursts).
  contracts:
    configuredId === 31337
      ? undefined
      : { multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11', blockCreated: 251449 } },
  blockExplorers:
    configuredId === 31337
      ? undefined
      : { default: { name: 'Monad Explorer', url: 'https://testnet.monadexplorer.com' } },
  testnet: true,
});
export const walletConfig = createConfig({
  chains: [chain],
  // Passkey (Mera) first: works with no extension. Browser wallets still connect if installed.
  connectors: [
    passkey(process.env.NEXT_PUBLIC_RPC_URL || undefined),
    // DEV ONLY: NEXT_PUBLIC_DEV_IMPERSONATE=<address> connects as that address through "Browser wallet",
    // for reviewing state-driven screens. Reads work on any chain; transactions only from an unlocked anvil
    // account. Its typed-data signatures come from anvil's first account, not the impersonated one, so sign
    // profiles with a script when testing locally (real wallets sign with their own key).
    ...(isAddress(process.env.NEXT_PUBLIC_DEV_IMPERSONATE ?? '')
      ? [mock({ accounts: [process.env.NEXT_PUBLIC_DEV_IMPERSONATE as Address], features: { reconnect: true } })]
      : []),
    injected(),
  ],
  // Concurrent reads are coalesced: multicall for contract reads, JSON-RPC batching for the rest.
  batch: { multicall: { wait: 32 } },
  transports: { [chain.id]: http(undefined, { batch: { wait: 32 } }) } as Record<
    (typeof chain)['id'],
    ReturnType<typeof http>
  >,
  ssr: true,
});
function address(value: string | undefined): Address | undefined {
  return value && isAddress(value) && value !== '0x0000000000000000000000000000000000000000'
    ? value
    : undefined;
}
export const deployment = {
  token: address(process.env.NEXT_PUBLIC_USDC_ADDRESS),
  factory: address(process.env.NEXT_PUBLIC_FACTORY_ADDRESS),
  vault: address(process.env.NEXT_PUBLIC_VAULT_ADDRESS),
  bonds: {
    pumplab: address(process.env.NEXT_PUBLIC_PUMPLAB_BOND_ADDRESS),
    'oracle-agent': address(process.env.NEXT_PUBLIC_AGENT_BOND_ADDRESS),
  } as Record<string, Address | undefined>,
};
