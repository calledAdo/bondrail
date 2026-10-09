import { defineChain, type Address } from 'viem';

export const monadTestnet = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet-rpc.monad.xyz'] } },
  blockExplorers: { default: { name: 'Monadscan', url: 'https://testnet.monadscan.com' } },
  testnet: true,
});
export const sliceLocal = defineChain({
  id: 31337,
  name: 'Slice Local',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['http://127.0.0.1:8545'] } },
  testnet: true,
});
export const supportedWriteChainIds = [31337, 10143] as const;
export const USDC_DECIMALS = 6;
export const USDC_UNIT = 1_000_000n;
export const Phase = { Funding: 0, Active: 1, Closing: 2, Closed: 3, Cancelled: 4 } as const;
export type PhaseName = keyof typeof Phase;
export interface Deployment {
  schemaVersion: 1;
  chainId: 31337 | 10143;
  network: string;
  deployedAt: string;
  startBlock: string;
  asset: Address;
  factory: Address;
  covenant: Address;
  forwarder: Address;
  issuers: Array<{
    name: string;
    account: Address;
    issuer: Address;
    bond?: Address;
    guard?: Address;
    source?: Address;
    endpoint?: string;
    agentId?: string;
  }>;
}
export interface DataCheckpoint {
  chainId: number;
  block: string;
  blockHash: string;
  observedAt: string;
  source: 'preview' | 'envio' | 'rpc';
  coverageComplete: boolean;
}
export function assertWriteNetwork(chainId: number): asserts chainId is 31337 | 10143 {
  if (chainId !== 31337 && chainId !== 10143)
    throw new Error('Slice write tools support local development and Monad testnet only.');
}
