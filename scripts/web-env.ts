import { type DeploymentFile } from './lib.ts';
export function webEnvironment(d: DeploymentFile, rpc: string, indexer: string) {
  return {
    BONDRAIL_DEPLOYMENT: d.deployment ?? 'main',
    NEXT_PUBLIC_CHAIN_ID: String(d.chainId), NEXT_PUBLIC_RPC_URL: rpc, NEXT_PUBLIC_INDEXER_URL: indexer,
    NEXT_PUBLIC_USDC_ADDRESS: d.asset, NEXT_PUBLIC_FACTORY_ADDRESS: d.factory,
    NEXT_PUBLIC_VAULT_ADDRESS: d.vault ?? '', NEXT_PUBLIC_CREDIT_REGISTRY_ADDRESS: d.creditRegistry ?? '',
    NEXT_PUBLIC_PUMPLAB_BOND_ADDRESS: d.issuers.pumplab?.bond ?? '',
    NEXT_PUBLIC_AGENT_BOND_ADDRESS: d.issuers.agent?.bond ?? '',
    NEXT_PUBLIC_DEV_IMPERSONATE: '',
  };
}
