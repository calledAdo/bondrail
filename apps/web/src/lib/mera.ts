// Passkey accounts with Mera: the passkey's PRF output is the only secret, and it is never stored.
//   account key : PRF output -> BIP-39 entropy -> m/44'/60'/0'/0/0
// The same passkey on any device reproduces the same account.
import {
  createPasskeyWithPrfOutput,
  createSecp256k1SigningSession,
  getPasskeyPrfOutput,
  isMeraError,
  type PasskeyCredentialMetadata,
} from '@category-labs/mera';
import { toViemAccount } from '@category-labs/mera/viem';
import { HDKey } from '@scure/bip32';
import { entropyToMnemonic, mnemonicToSeedSync } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import type { LocalAccount } from 'viem';

export const ACCOUNT_PATH = "m/44'/60'/0'/0/0";
const rp = () => ({ id: window.location.hostname, name: 'Slice' });

export type MeraSession = { account: LocalAccount; credential: PasskeyCredentialMetadata; end: () => void };

/** Derive the account from PRF output and open a signing session; raw key bytes are wiped. */
function open(prfOutput: Uint8Array, credential: PasskeyCredentialMetadata): MeraSession {
  const seed = mnemonicToSeedSync(entropyToMnemonic(prfOutput, wordlist));
  const node = HDKey.fromMasterSeed(seed).derive(ACCOUNT_PATH);
  const privateKey = node.privateKey!;
  const session = createSecp256k1SigningSession({ privateKey });
  privateKey.fill(0);
  seed.fill(0);
  prfOutput.fill(0);
  return { account: toViemAccount(session), credential, end: () => session.end() };
}

export async function createAccount(): Promise<MeraSession> {
  const r = await createPasskeyWithPrfOutput({
    rp: rp(),
    user: { name: 'Slice account', displayName: 'Slice' },
  });
  return open(r.prfOutput, { credentialId: r.credentialId, transports: r.transports });
}

/** Discoverable sign-in: works on a fresh device with no stored state. */
export async function signIn(credential?: PasskeyCredentialMetadata): Promise<MeraSession> {
  const r = await getPasskeyPrfOutput({ rpId: rp().id, credential });
  return open(r.prfOutput, { credentialId: r.credentialId });
}

export function meraMessage(e: unknown): string {
  if (isMeraError(e)) {
    if (e.code === 'PRF_UNAVAILABLE')
      return "This passkey provider can't derive keys (no PRF). Use iCloud Keychain, Google Password Manager or 1Password in a current browser.";
    if (e.code === 'PASSKEY_OPERATION_FAILED') return 'Passkey prompt was cancelled.';
  }
  return (e as Error)?.message ?? String(e);
}
