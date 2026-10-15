import {
  classify,
  endpointsToCheck,
  parseManifest,
  type FetchedResponse,
  type ParsedOffer,
  type WatchPolicy,
} from '@bondrail/observer/protocol';

/** Never signs a payment or follows a redirect to a different resource. */
export async function fetchUnpaid(
  url: string,
  headers: Record<string, string>,
  fetcher: typeof fetch = fetch,
): Promise<FetchedResponse> {
  try {
    const response = await fetcher(url, {
      method: 'GET', headers, redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(8000),
    });
    return {
      status: response.status,
      header: response.headers.get('PAYMENT-REQUIRED') ?? undefined,
      body: await response.text(),
    };
  } catch {
    // The observer classifies transport failures as Unknown, which also blocks issuance.
    return { status: 0 };
  }
}

/** Prefer the canonical base resource, or validate an explicit AGENT_URL against the manifest. */
export function selectAgentEndpoint(manifest: FetchedResponse, policy: WatchPolicy, requested?: string): string {
  const parsed = parseManifest(manifest.status, manifest.body, {
    ...policy, endpoints: requested ? [{ url: requested, minAmount: '10000' }] : [],
  });
  if (parsed.result !== 1) throw new Error(`Watched preflight refused: ${parsed.reason}`);
  const listed: unknown[] = JSON.parse(manifest.body!).endpoints;
  const canonical = new URL('/api/oracle', policy.manifestUrl).href;
  const endpoint = requested ?? (listed.includes(canonical) ? canonical : listed[0]);
  if (typeof endpoint !== 'string') throw new Error('Watched preflight refused: manifest has no paid endpoint');
  const url = new URL(endpoint);
  const local = policy.chainId === 31337 && ['127.0.0.1', 'localhost'].includes(url.hostname);
  if (url.origin !== new URL(policy.manifestUrl).origin || url.username || url.password || url.hash ||
      (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
      (!local && url.port && url.port !== '443'))
    throw new Error('Watched preflight refused: endpoint must use the manifest HTTPS origin (loopback allowed locally)');
  // Preserve the listed spelling: the observer compares resource URLs exactly.
  return endpoint;
}

export function assertPreflightMode(skip: boolean, chainId: number, environment: string | undefined) {
  if (skip && (chainId !== 31337 || environment !== 'local'))
    throw new Error('--skip-preflight is only allowed for local tests (chain 31337 and BONDRAIL_ENV=local)');
}

/** The same endpoint expansion and pure classification used by both CRE and the observer. */
export async function checkWatchedPolicy(
  policy: WatchPolicy,
  fetcher: typeof fetch = fetch,
  manifest?: FetchedResponse,
): Promise<ParsedOffer> {
  const fetchedManifest = manifest ?? await fetchUnpaid(policy.manifestUrl, policy.headers, fetcher);
  const endpoints = endpointsToCheck(policy, fetchedManifest);
  const offers = await Promise.all(endpoints.map((endpoint) => fetchUnpaid(endpoint.url, policy.headers, fetcher)));
  return classify(policy, fetchedManifest, endpoints, offers);
}

export async function preflightWatchedPolicy(
  policy: WatchPolicy,
  fetcher: typeof fetch = fetch,
  manifest?: FetchedResponse,
): Promise<ParsedOffer> {
  const result = await checkWatchedPolicy(policy, fetcher, manifest);
  if (result.result !== 1) throw new Error(`Watched preflight refused: ${result.reason}`);
  return result;
}
