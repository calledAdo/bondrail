import type { PaymentPayload, PaymentRequirements, SettleResponse, SupportedResponse, VerifyResponse } from '@x402/core/types';
import {
  BaseError, ContractFunctionRevertedError, ContractFunctionZeroDataError,
  encodeFunctionData, isAddress, keccak256, parseAbi, parseSignature, verifyTypedData, zeroAddress,
  WaitForTransactionReceiptTimeoutError, TransactionReceiptNotFoundError,
  type Account, type Address, type Chain, type Hex, type PublicClient, type Transport, type TypedDataDomain, type WalletClient,
} from 'viem';
import { bondrailAccountAbi, bondrailFactoryAbi } from '@bondrail/sdk/abis';
import type { TransferAuthorization } from '@bondrail/sdk/x402';
import type { DurableStore } from '@bondrail/observer/store';
import { isTransientRpcError } from '@bondrail/shared';
import { setTimeout as delay } from 'node:timers/promises';
import { defaultGasPolicy, validateGasPolicy, type GasPolicy } from './gas.js';
import { settlementSender, type GasEvent } from './settlement.js';

export const authorizationTypes = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' }, { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
  ],
} as const;
const tokenAbi = parseAbi([
  'function eip712Domain() view returns (bytes1 fields, string name, string version, uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions)',
  'function name() view returns (string)',
  'function version() view returns (string)',
  'function authorizationState(address authorizer, bytes32 nonce) view returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
]);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const addr = (v: unknown): v is Address => typeof v === 'string' && isAddress(v, { strict: false });
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const uint = (v: unknown): v is string => typeof v === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(v) && BigInt(v) < 2n ** 256n;
const bytes32 = (v: unknown): v is Hex => typeof v === 'string' && /^0x[0-9a-fA-F]{64}$/.test(v);

type GasWallet = WalletClient<Transport, Chain, Account>;

export interface FacilitatorOptions {
  factory: Address;
  asset: Address;
  /** Retain across restarts; an authorization is bound to one calldata payload and wallet nonce. */
  store: DurableStore;
  publicClient: Pick<PublicClient, 'getChainId' | 'getBlock' | 'readContract' | 'simulateContract' | 'waitForTransactionReceipt' |
    'estimateGas' | 'getBalance' | 'getTransactionCount' | 'getTransactionReceipt'>;
  /** A factory lets server startup configure the gas wallet from the cached RPC chain ID. */
  walletClient: GasWallet | ((chainId: number) => GasWallet);
  domainName?: string;
  domainVersion?: string;
  now?: () => number;
  gasPolicy?: GasPolicy;
  log?: (event: GasEvent) => void;
  onLowBalance?: (event: GasEvent) => Promise<void>;
}

async function tokenDomain(o: FacilitatorOptions, chainId: number): Promise<TypedDataDomain> {
  const discovered = await o.publicClient.readContract({
    address: o.asset, abi: tokenAbi, functionName: 'eip712Domain',
  }).catch((error: unknown) => {
    // Older tokens may revert or return no data for the unknown ERC-5267 selector.
    // Transport failures must still abort startup, even when both overrides are configured.
    if (!(error instanceof BaseError && error.walk(cause =>
      cause instanceof ContractFunctionRevertedError || cause instanceof ContractFunctionZeroDataError))) throw error;
    return undefined;
  });
  if (discovered) {
    const [fields, name, version, domainChainId, verifyingContract, salt, extensions] = discovered;
    const mask = Number(fields);
    // Require chain/asset binding and the name/version used by x402; honor optional salt.
    if ((mask & 0x0f) !== 0x0f || (mask & ~0x1f) !== 0 || extensions.length)
      throw new Error('unsupported_token_domain');
    if (domainChainId !== BigInt(chainId) || !same(verifyingContract, o.asset))
      throw new Error('token_domain_mismatch');
    return { name: o.domainName ?? name, version: o.domainVersion ?? version, chainId, verifyingContract,
      ...(mask & 0x10 ? { salt } : {}) };
  }
  const [name, version] = await Promise.all([
    o.domainName ?? o.publicClient.readContract({ address: o.asset, abi: tokenAbi, functionName: 'name' }),
    o.domainVersion ?? o.publicClient.readContract({ address: o.asset, abi: tokenAbi, functionName: 'version' }),
  ]);
  return { name, version, chainId, verifyingContract: o.asset };
}

/** Discover and cache the RPC chain and pinned token's domain before accepting payments. */
export async function createFacilitator(o: FacilitatorOptions) {
  if (!addr(o.factory) || !addr(o.asset) || same(o.factory, zeroAddress) || same(o.asset, zeroAddress))
    throw new Error('Nonzero factory and asset addresses required');
  const chainId = await o.publicClient.getChainId();
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error('invalid_rpc_chain_id');
  const network = `eip155:${chainId}` as const;
  const walletClient = typeof o.walletClient === 'function' ? o.walletClient(chainId) : o.walletClient;
  if (walletClient.chain.id !== chainId) throw new Error('rpc_chain_mismatch');
  const domain = await tokenDomain(o, chainId);
  const now = o.now ?? (() => Math.floor(Date.now() / 1000));

  function parse(payload: PaymentPayload, requirements: PaymentRequirements) {
    const p: unknown = payload, r: unknown = requirements;
    if (!record(p) || p.x402Version !== 2 || !record(p.accepted) || !record(p.payload) || !record(r))
      throw new Error('invalid_payload');
    const supported = (v: Record<string, unknown>) => v.scheme === 'exact' && v.network === network &&
      addr(v.asset) && same(v.asset, o.asset) && addr(v.payTo) && !same(v.payTo, zeroAddress) &&
      uint(v.amount) && BigInt(v.amount) > 0n && Number.isSafeInteger(v.maxTimeoutSeconds) &&
      Number(v.maxTimeoutSeconds) > 0 && Number(v.maxTimeoutSeconds) <= 3600 && record(v.extra) &&
      v.extra.name === domain.name && v.extra.version === domain.version && v.extra.assetTransferMethod === 'eip3009';
    if (!supported(r) || !supported(p.accepted)) throw new Error('unsupported_requirements');
    if (!same(String(r.payTo), String(p.accepted.payTo)) || r.amount !== p.accepted.amount ||
        r.maxTimeoutSeconds !== p.accepted.maxTimeoutSeconds) throw new Error('requirements_mismatch');
    const a = p.payload.authorization;
    if (!record(a) || !addr(a.from) || !addr(a.to) || !uint(a.value) || !uint(a.validAfter) ||
        !uint(a.validBefore) || !bytes32(a.nonce) || typeof p.payload.signature !== 'string' ||
        !/^0x[0-9a-fA-F]{130}$/.test(p.payload.signature)) throw new Error('invalid_authorization');
    if (same(a.from, zeroAddress) || same(a.from, a.to) || !same(a.to, String(r.payTo)) || a.value !== r.amount)
      throw new Error('authorization_mismatch');
    return { authorization: a as unknown as TransferAuthorization, signature: p.payload.signature as Hex };
  }

  async function checked(payload: PaymentPayload, requirements: PaymentRequirements) {
    const payment = parse(payload, requirements);
    const { authorization: a, signature } = payment;
    const block = await o.publicClient.getBlock();
    const timestamp = BigInt(Math.max(now(), Number(block.timestamp)));
    // EIP-3009 uses strict inequalities. Leave six seconds for inclusion, and reject overlong offers.
    if (BigInt(a.validAfter) >= timestamp || BigInt(a.validBefore) < timestamp + 6n ||
        BigInt(a.validBefore) > timestamp + BigInt(requirements.maxTimeoutSeconds))
      throw new Error('invalid_time_window');
    const valid = await verifyTypedData({
      address: a.from, domain, types: authorizationTypes, primaryType: 'TransferWithAuthorization',
      message: { ...a, value: BigInt(a.value), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore) },
      signature,
    });
    if (!valid) throw new Error('invalid_signature');
    if (!await o.publicClient.readContract({ address: o.factory, abi: bondrailFactoryAbi, functionName: 'isAccount', args: [a.to] }))
      throw new Error('pay_to_not_bondrail_account');
    const asset = await o.publicClient.readContract({ address: a.to, abi: bondrailAccountAbi, functionName: 'asset' });
    if (!same(asset, o.asset)) throw new Error('account_asset_mismatch');
    if (await o.publicClient.readContract({ address: o.asset, abi: tokenAbi, functionName: 'authorizationState', args: [a.from, a.nonce] }))
      throw new Error('authorization_used');
    const balance = await o.publicClient.readContract({ address: o.asset, abi: tokenAbi, functionName: 'balanceOf', args: [a.from] });
    if (balance < BigInt(a.value)) throw new Error('insufficient_funds');
    const { r, s, yParity } = parseSignature(signature);
    // Also rejects old account implementations, paused/blocked tokens and wrong on-chain domains.
    await o.publicClient.simulateContract({
      account: walletClient.account, address: a.to, abi: bondrailAccountAbi, functionName: 'settle',
      args: [a.from, BigInt(a.value), BigInt(a.validAfter), BigInt(a.validBefore), a.nonce, 27 + yParity, r, s],
    });
    return payment;
  }

  const reason = (e: unknown) => e instanceof Error && /^[a-z_]+$/.test(e.message) ? e.message : 'chain_validation_failed';
  async function confirmed(transaction: Hex) {
    // Each wait has its own deadline. Replacement detection would scan entire blocks and could
    // mistake a successful cancellation for settlement; only accept the exact signed hash.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const receipt = await o.publicClient.waitForTransactionReceipt({
          hash: transaction, confirmations: 1, timeout: 20_000, pollingInterval: 1500,
          checkReplacement: false, retryCount: 0,
        });
        if (receipt.transactionHash !== transaction) throw new Error('settlement_receipt_mismatch');
        if (receipt.status !== 'success') throw new Error('settlement_reverted');
        return;
      } catch (error) {
        if (attempt === 2 || !(isTransientRpcError(error) || error instanceof WaitForTransactionReceiptTimeoutError ||
            error instanceof TransactionReceiptNotFoundError)) throw error;
        await delay(250 + Math.random() * 250);
      }
    }
  }
  const sender = settlementSender({ chainId, client: o.publicClient, wallet: walletClient, store: o.store,
    policy: validateGasPolicy(o.gasPolicy ?? defaultGasPolicy), now,
    log: o.log ?? (event => console.error(JSON.stringify(event))), onLowBalance: o.onLowBalance });
  return {
    health: sender.health,
    recover: sender.recover,
    supported(): SupportedResponse {
      return {
        kinds: [{ x402Version: 2, scheme: 'exact', network, extra: { assetTransferMethod: 'eip3009' } }],
        extensions: [], signers: { [network]: [walletClient.account.address] },
      };
    },
    async verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse> {
      try {
        const { authorization } = await checked(payload, requirements);
        return { isValid: true, payer: authorization.from };
      } catch (e) { return { isValid: false, invalidReason: reason(e) }; }
    },
    settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse> {
      const run = async (): Promise<SettleResponse> => {
        let transaction: Hex | undefined;
        let payer: Address | undefined;
        try {
          const { authorization, signature } = parse(payload, requirements);
          payer = authorization.from;
          const { r, s, yParity } = parseSignature(signature);
          const data = encodeFunctionData({ abi: bondrailAccountAbi, functionName: 'settle',
            args: [payer, BigInt(authorization.value), BigInt(authorization.validAfter),
              BigInt(authorization.validBefore), authorization.nonce, 27 + yParity, r, s] });
          const binding = `${authorization.to.toLowerCase()}:${keccak256(data)}`;
          const key = `facilitator:${chainId}:${o.asset.toLowerCase()}:${payer.toLowerCase()}:${authorization.nonce.toLowerCase()}`;
          const result = await sender.submit(key, binding, async () => {
            await checked(payload, requirements);
            return { to: authorization.to, data, validBefore: Number(authorization.validBefore) };
          }, confirmed);
          transaction = result.transaction;
          if (result.errorReason) throw new Error(result.errorReason);
          return { success: true, transaction, network, payer, amount: authorization.value };
        } catch (e) {
          // A nonempty hash is an ambiguous or mined outcome; never claim that it was uncharged.
          return { success: false, transaction: transaction ?? '', network, payer,
            errorReason: transaction && reason(e) === 'chain_validation_failed' ? 'settlement_pending' : reason(e) };
        }
      };
      return run();
    },
  };
}
