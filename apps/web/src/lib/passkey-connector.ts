// A wagmi connector backed by a Mera passkey account, so every existing wagmi hook (useAccount,
// useWalletClient, writeContract...) works with Face ID / Touch ID and no browser extension.
// Transactions are signed in the page by the Mera signing session and sent to the configured RPC.
import { createConnector } from 'wagmi';
import { createPublicClient, createWalletClient, http, numberToHex, type Address, type Hex } from 'viem';
import { createAccount, meraMessage, signIn, type MeraSession } from './mera';

let mode: 'signin' | 'create' = 'signin';
/** Choose what the next connect() does: open an existing passkey account or create a new one. */
export const setPasskeyMode = (m: 'signin' | 'create') => {
  mode = m;
};

export function passkey(rpcUrl?: string) {
  return createConnector((config) => {
    const chain = config.chains[0];
    let session: MeraSession | null = null;
    const transport = http(rpcUrl);
    const publicClient = () => createPublicClient({ chain, transport });
    const walletClient = () => createWalletClient({ account: session!.account, chain, transport });

    // Minimal EIP-1193 surface for anything that asks the provider directly.
    const provider = {
      async request({ method, params }: { method: string; params?: unknown[] }): Promise<unknown> {
        const account = session?.account;
        switch (method) {
          case 'eth_accounts':
          case 'eth_requestAccounts':
            return account ? [account.address] : [];
          case 'eth_chainId':
            return numberToHex(chain.id);
          case 'wallet_switchEthereumChain':
            return null;
          case 'eth_sendTransaction': {
            if (!account) throw new Error('Not connected');
            const tx = (params?.[0] ?? {}) as { to?: Address; data?: Hex; value?: Hex; gas?: Hex };
            return walletClient().sendTransaction({
              to: tx.to,
              data: tx.data,
              value: tx.value ? BigInt(tx.value) : undefined,
              gas: tx.gas ? BigInt(tx.gas) : undefined,
            } as never);
          }
          case 'personal_sign':
            if (!account?.signMessage) throw new Error('Not connected');
            return account.signMessage({ message: { raw: params![0] as Hex } });
          case 'eth_signTypedData_v4':
            if (!account?.signTypedData) throw new Error('Not connected');
            return account.signTypedData(JSON.parse(params![1] as string));
          default:
            return publicClient().request({ method, params } as never);
        }
      },
      on() {},
      removeListener() {},
    };

    return {
      id: 'passkey',
      name: 'Passkey',
      type: 'passkey',
      async connect() {
        try {
          session?.end();
          session = mode === 'create' ? await createAccount() : await signIn();
        } catch (e) {
          throw new Error(meraMessage(e));
        }
        const address = session.account.address;
        // First visit: top up a little testnet MON so the first transaction needs no faucet.
        fetch('/api/drip', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ address }),
        }).catch(() => undefined);
        return { accounts: [address] as never, chainId: chain.id };
      },
      async disconnect() {
        session?.end();
        session = null;
      },
      async getAccounts() {
        return session ? [session.account.address] : [];
      },
      async getChainId() {
        return chain.id;
      },
      async getProvider() {
        return provider;
      },
      async getClient() {
        if (!session) throw new Error('Not connected');
        return walletClient() as never;
      },
      // Sessions live in memory only: a reload asks for the passkey again.
      async isAuthorized() {
        return false;
      },
      onAccountsChanged() {},
      onChainChanged() {},
      onDisconnect() {
        session?.end();
        session = null;
        config.emitter.emit('disconnect');
      },
    };
  });
}
