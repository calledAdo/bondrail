// A business profile, signed with EIP-712 by the SliceAccount's issuer. Stored off-chain (/api/registry);
// anyone can re-verify the signature against `account.issuer()`. The website's /.well-known/slice.json
// naming the account is the domain proof.
import type { Address } from 'viem';

export type Profile = {
  account: Address;
  name: string;
  description: string;
  website: string;
  x: string;
  useOfFunds: string;
  updatedAt: bigint;
};

export const profileDomain = (chainId: number) => ({ name: 'Slice Profile', version: '1', chainId });

export const profileTypes = {
  Profile: [
    { name: 'account', type: 'address' },
    { name: 'name', type: 'string' },
    { name: 'description', type: 'string' },
    { name: 'website', type: 'string' },
    { name: 'x', type: 'string' },
    { name: 'useOfFunds', type: 'string' },
    { name: 'updatedAt', type: 'uint64' },
  ],
} as const;

/** What the registry returns for an account: the signed profile, plus the server's domain check. */
export type ProfileRecord = {
  profile: Omit<Profile, 'updatedAt'> & { updatedAt: string };
  signature: `0x${string}`;
  signer: Address;
  domainVerified: boolean;
  checkedAt: number;
};

/** A Kuru claim/quote market, proven by its registration receipt. */
export type KuruRecord = { bond: Address; market: Address; vault: Address; tx: `0x${string}` };

export const LIMITS = { name: 60, description: 400, website: 200, x: 40, useOfFunds: 400 } as const;
