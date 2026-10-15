import { createPublicClient, createWalletClient, isAddress, type Hex } from 'viem';
import { createRpcTransport, rpcUrlsFromEnv } from '@bondrail/shared';
import { storeFromEnv } from '@bondrail/observer/store';
import { privateKeyToAccount } from 'viem/accounts';
import { createFacilitator } from './index.js';
import { facilitatorServer } from './http.js';

const { FACILITATOR_PRIVATE_KEY, FACILITATOR_FACTORY, FACILITATOR_RPC_URL } = process.env;
const urls = rpcUrlsFromEnv(FACILITATOR_RPC_URL);
const asset = process.env.FACILITATOR_ASSET ?? '0x534b2f3A21130d7a60830c2Df862319e593943A3';
if (!/^0x[0-9a-fA-F]{64}$/.test(FACILITATOR_PRIVATE_KEY ?? '') ||
    !FACILITATOR_FACTORY || !isAddress(FACILITATOR_FACTORY) || !isAddress(asset) || !urls.length)
  throw new Error('Facilitator private key, factory, asset and RPC URL required');
const transport = createRpcTransport(urls);
const publicClient = createPublicClient({ transport });
const server = facilitatorServer(await createFacilitator({
  factory: FACILITATOR_FACTORY, asset, publicClient, store: storeFromEnv(),
  domainName: process.env.FACILITATOR_DOMAIN_NAME,
  domainVersion: process.env.FACILITATOR_DOMAIN_VERSION,
  walletClient: chainId => createWalletClient({
    chain: {
      id: chainId, name: `EVM ${chainId}`,
      nativeCurrency: { name: 'Native', symbol: 'NATIVE', decimals: 18 },
      rpcUrls: { default: { http: urls } },
    },
    account: privateKeyToAccount(FACILITATOR_PRIVATE_KEY as Hex), transport,
  }),
}));
server.listen(Number(process.env.FACILITATOR_PORT ?? 8788), process.env.FACILITATOR_HOST ?? '127.0.0.1');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
