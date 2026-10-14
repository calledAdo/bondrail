import {
  cre,
  consensusIdenticalAggregation,
  getHeader,
  text,
  hexToBase64,
  prepareReportRequest,
  bytesToHex,
  type HTTPSendRequester,
  type Runtime,
} from '@chainlink/cre-sdk';
import { recoverTypedDataAddress, stringToHex, type Address } from 'viem';
import {
  canonical,
  encodeObservationReport,
  observationDomain,
  observationTypes,
  classify,
  endpointsToCheck,
  policyHash,
  type FetchedResponse,
  typedObservation,
  type SignedObservation,
  type WatchPolicy,
} from '@bondrail/observer/protocol';

export interface WorkflowConfig {
  /** Local `cre workflow simulate` only: allow an observer on http://127.0.0.1. */
  simulationLoopbackObserver?: boolean;
  schedule: string;
  observerURL: string;
  observerSigner: Address;
  policy: WatchPolicy;
  gasLimit: string;
}
function independentlyObserve(
  send: HTTPSendRequester,
  c: WorkflowConfig,
  token: string,
  epoch: number,
): string {
  const attested = send
    .sendRequest({
      url: c.observerURL,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: hexToBase64(stringToHex(JSON.stringify({ watchId: c.policy.id, epoch }))),
      timeout: '10s',
    })
    .result();
  if (attested.statusCode !== 200 || attested.body.length > 16384)
    throw new Error('Observer unavailable; no report');
  const signed = JSON.parse(text(attested)) as SignedObservation;
  // Fetch the manifest and every covered endpoint ourselves; a failed fetch counts as no response.
  const get = (url: string): FetchedResponse => {
    try {
      const live = send.sendRequest({ url, method: 'GET', headers: c.policy.headers, timeout: '8s' }).result();
      if (live.body.length > 65536) return { status: 0 };
      return { status: live.statusCode, header: getHeader(live, 'PAYMENT-REQUIRED'), body: text(live) };
    } catch {
      return { status: 0 };
    }
  };
  const manifest = get(c.policy.manifestUrl);
  const endpoints = endpointsToCheck(c.policy, manifest);
  const parsed = classify(
    c.policy,
    manifest,
    endpoints,
    endpoints.map((e) => get(e.url)),
  );
  // Only canonical policy-relevant content reaches identical consensus, never Date/Server headers.
  return canonical({
    signed,
    parsed: {
      result: parsed.result,
      offerHash: parsed.offerHash,
      observedPayTo: parsed.observedPayTo.toLowerCase(),
    },
  });
}
export async function onCron(runtime: Runtime<WorkflowConfig>): Promise<string> {
  const c = runtime.config,
    now = Math.floor(runtime.now().getTime() / 1000),
    epoch = Math.floor(now / 30);
  if (c.policy.chainId !== 10143 || c.policy.chainSelector !== '2183018362218727504')
    throw new Error('CRE writes are limited to Monad testnet');
  // The observer may be on loopback only while the workflow itself runs as a local simulation.
  const observerOk =
    /^https:\/\/[^/@\s]+\/observe$/.test(c.observerURL) ||
    (c.simulationLoopbackObserver === true && /^http:\/\/127\.0\.0\.1:\d+\/observe$/.test(c.observerURL));
  const https = (u: string) => /^https:\/\/[^/@\s]+\//.test(u);
  if (!https(c.policy.manifestUrl) || !c.policy.endpoints.every((e) => https(e.url)) || !observerOk)
    throw new Error('Public immutable HTTPS endpoints required');
  const token = runtime.getSecret({ id: 'OBSERVER_API_TOKEN' }).result().value;
  if (token.length < 32) throw new Error('Observer credential missing');
  const client = new cre.capabilities.HTTPClient();
  const consensus = client
    .sendRequest(runtime, independentlyObserve, consensusIdenticalAggregation<string>())(c, token, epoch)
    .result();
  const { signed, parsed } = JSON.parse(consensus) as {
    signed: SignedObservation;
    parsed: { result: number; offerHash: string; observedPayTo: string };
  };
  const o = signed.observation,
    p = c.policy;
  if (
    o.bond.toLowerCase() !== p.bond.toLowerCase() ||
    o.policyHash !== policyHash(p) ||
    BigInt(o.epoch) !== BigInt(epoch) ||
    BigInt(o.observedAt) / 30n !== BigInt(epoch) ||
    BigInt(o.observedAt) > BigInt(now + 5) ||
    BigInt(o.expiresAt) !== BigInt(o.observedAt) + 90n ||
    BigInt(o.expiresAt) < BigInt(now) ||
    o.result !== parsed.result ||
    o.offerHash !== parsed.offerHash ||
    o.observedPayTo.toLowerCase() !== parsed.observedPayTo
  )
    throw new Error('Independent evidence disagrees; no report');
  const signer = await recoverTypedDataAddress({
    domain: observationDomain(p),
    types: observationTypes,
    primaryType: 'Observation',
    message: typedObservation(o),
    signature: signed.signature,
  });
  if (signer.toLowerCase() !== c.observerSigner.toLowerCase()) throw new Error('Invalid observer signature');
  const report = runtime.report(prepareReportRequest(encodeObservationReport(signed))).result();
  const evm = new cre.capabilities.EVMClient(BigInt(p.chainSelector));
  const result = evm
    .writeReport(runtime, {
      receiver: p.covenant,
      report,
      gasConfig: { gasLimit: c.gasLimit },
    })
    .result();
  if (result.txStatus !== 2 || result.receiverContractExecutionStatus !== 0)
    throw new Error('Report not confirmed by receiver');
  if (!result.txHash?.length || result.txHash.every((b: number) => b === 0)) {
    runtime.log('SLICE_SIMULATION_ONLY: no broadcast receipt');
    return 'simulation_only';
  }
  const tx = bytesToHex(result.txHash);
  runtime.log(`SLICE_REPORT_TX=${tx}`);
  // The reporter reads this: a violation is confirmed by a second report in the next epoch.
  runtime.log(`SLICE_RESULT=${o.result} SLICE_EPOCH=${o.epoch}`);
  return tx;
}
export function initWorkflow(config: WorkflowConfig) {
  return [
    cre.handler(
      new cre.capabilities.CronCapability().trigger({
        schedule: config.schedule,
      }),
      onCron,
    ),
  ];
}
