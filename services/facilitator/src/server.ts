import { createPublicClient, createWalletClient, http, isAddress, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { monadTestnet } from 'viem/chains';
import { createFacilitator } from './index.js';
import { facilitatorServer } from './http.js';

const { FACILITATOR_PRIVATE_KEY, FACILITATOR_FACTORY, FACILITATOR_RPC_URL } = process.env;
const asset = process.env.FACILITATOR_ASSET ?? '0x534b2f3A21130d7a60830c2Df862319e593943A3';
if (!/^0x[0-9a-fA-F]{64}$/.test(FACILITATOR_PRIVATE_KEY ?? '') ||
    !FACILITATOR_FACTORY || !isAddress(FACILITATOR_FACTORY) || !isAddress(asset) || !FACILITATOR_RPC_URL)
  throw new Error('Facilitator private key, factory, asset and RPC URL required');
const rpc = new URL(FACILITATOR_RPC_URL);
if (!['https:', 'http:'].includes(rpc.protocol)) throw new Error('Invalid RPC protocol');
const publicClient = createPublicClient({ chain: monadTestnet, transport: http(FACILITATOR_RPC_URL) });
if (await publicClient.getChainId() !== monadTestnet.id) throw new Error('RPC chain mismatch');
const walletClient = createWalletClient({
  chain: monadTestnet, account: privateKeyToAccount(FACILITATOR_PRIVATE_KEY as Hex), transport: http(FACILITATOR_RPC_URL),
});
const server = facilitatorServer(createFacilitator({ factory: FACILITATOR_FACTORY, asset, publicClient, walletClient }));
server.listen(Number(process.env.FACILITATOR_PORT ?? 8788), process.env.FACILITATOR_HOST ?? '127.0.0.1');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
