import { createTransport, http, HttpRequestError, type EIP1193RequestFn, type HttpTransportConfig, type Transport } from 'viem';

export interface RpcScheduler {
  /** Monotonic time in milliseconds. */
  now(): number;
  /** Schedule a callback and return a function that cancels it. */
  schedule(callback: () => void, delayMs: number): () => void;
}

export interface RpcTransportOptions {
  /** By default all transports in this process share a bucket; the lowest configured limits win. */
  rps?: number;
  concurrency?: number;
  /** Retries per URL, after the initial attempt. */
  retryCount?: number;
  retryDelay?: number;
  timeout?: number;
  fetchFn?: HttpTransportConfig['fetchFn'];
  /** Defaults to real time. Transports using the same scheduler share a pacing bucket. */
  scheduler?: RpcScheduler;
  /** Jitter source in [0, 1); defaults to Math.random. */
  random?: () => number;
}

/** The plural setting takes precedence; legacy service settings can be supplied as fallback. */
export function rpcUrlsFromEnv(fallback?: string, env = process.env): string[] {
  const urls = (env.BONDRAIL_RPC_URLS || env.BONDRAIL_RPC_URL || fallback || '')
    .split(',').map(url => url.trim()).filter(Boolean);
  return [...new Set(urls)];
}

function positive(value: number, name: string) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid RPC ${name}`);
  return value;
}

// Capacity one prevents idle time from accumulating a burst. Every HTTP attempt, including
// retries, wallet preparation and failover, consumes a token from this process-wide bucket.
class RpcBucket {
  rps = Infinity;
  concurrency = Infinity;
  private tokens = 1;
  private updatedAt: number;
  private active = 0;
  private blockedUntil = 0;
  private queue: Array<() => void> = [];
  private cancelTimer?: () => void;

  constructor(private scheduler: RpcScheduler) {
    this.updatedAt = scheduler.now();
  }

  configure(rps: number, concurrency: number) {
    this.rps = Math.min(this.rps, rps);
    this.concurrency = Math.min(this.concurrency, concurrency);
  }

  coolDown(ms: number) {
    this.blockedUntil = Math.max(this.blockedUntil, this.scheduler.now() + ms);
  }

  async run<T>(request: () => Promise<T>): Promise<T> {
    await new Promise<void>(resolve => { this.queue.push(resolve); this.drain(); });
    try { return await request(); }
    finally { this.active--; this.drain(); }
  }

  private drain() {
    this.cancelTimer?.();
    this.cancelTimer = undefined;
    if (!this.queue.length || this.active >= this.concurrency) return;
    const now = this.scheduler.now();
    this.tokens = Math.min(1, this.tokens + (now - this.updatedAt) * this.rps / 1000);
    this.updatedAt = now;
    const wait = Math.max(this.blockedUntil - now, (1 - this.tokens) * 1000 / this.rps);
    if (wait > 0) {
      this.cancelTimer = this.scheduler.schedule(() => this.drain(), Math.ceil(wait));
      return;
    }
    this.tokens--;
    this.active++;
    this.queue.shift()!();
    this.drain();
  }
}
const realScheduler: RpcScheduler = {
  now: () => performance.now(),
  schedule: (callback, delayMs) => {
    const timer = setTimeout(callback, delayMs);
    return () => clearTimeout(timer);
  },
};
// The default bucket remains process-wide. A custom scheduler also isolates its time domain.
const buckets = new WeakMap<RpcScheduler, RpcBucket>([[realScheduler, new RpcBucket(realScheduler)]]);
// Remember restrictions across public/wallet clients, not only one transport instance.
const restrictedMethods = new Map<string, Map<string, unknown>>();

export function isTransientRpcError(error: unknown): boolean {
  const { status, message, network } = errorDetails(error);
  return status === 429 || /limited|rate/i.test(message) || network || (status !== undefined && status >= 500);
}

function errorDetails(error: unknown) {
  let status: number | undefined;
  let message = '';
  let network = false;
  const seen = new Set<unknown>();
  while (error && typeof error === 'object' && !seen.has(error)) {
    seen.add(error);
    const e = error as { status?: number; details?: string; shortMessage?: string; message?: string; name?: string; cause?: unknown };
    status ??= e.status;
    // Avoid scanning viem's verbose message, which contains provider URLs and request bodies.
    message += ` ${e.details ?? e.shortMessage ?? e.message ?? ''}`;
    network ||= e.name === 'TimeoutError' || (e.name === 'HttpRequestError' && e.status === undefined);
    error = e.cause;
  }
  return { status, message, network };
}

export function createRpcTransport(urls: readonly string[], opts: RpcTransportOptions = {}): Transport {
  const ordered = [...new Set(urls.map(url => url.trim()).filter(Boolean))];
  if (!ordered.length) throw new Error('At least one RPC URL is required');
  for (const url of ordered) {
    if (!['http:', 'https:'].includes(new URL(url).protocol)) throw new Error('Invalid RPC protocol');
  }
  const rps = positive(opts.rps ?? Number(process.env.BONDRAIL_RPC_RPS ?? 6), 'RPS');
  const concurrency = positive(opts.concurrency ?? Number(process.env.BONDRAIL_RPC_CONCURRENCY ?? 2), 'concurrency');
  const retryCount = opts.retryCount ?? 2;
  const retryDelay = positive(opts.retryDelay ?? 500, 'retry delay');
  const timeout = positive(opts.timeout ?? 10_000, 'timeout');
  if (!Number.isSafeInteger(concurrency) || !Number.isSafeInteger(retryCount) || retryCount < 0)
    throw new Error('Invalid RPC concurrency or retry count');
  const scheduler = opts.scheduler ?? realScheduler;
  let bucket = buckets.get(scheduler);
  if (!bucket) {
    bucket = new RpcBucket(scheduler);
    buckets.set(scheduler, bucket);
  }
  bucket.configure(rps, concurrency);
  const random = opts.random ?? Math.random;

  return parameters => {
    const transports = ordered.map(url => http(url, {
      batch: false, retryCount: 0, timeout, fetchFn: opts.fetchFn,
      // viem normally unwraps JSON-RPC errors on non-2xx responses and loses HTTP status.
      // Preserve it so even a 429 with an opaque JSON body gets retried.
      onFetchResponse: async response => {
        if (response.status === 429 || response.status === 403 || response.status >= 500) throw new HttpRequestError({
          url, status: response.status, headers: response.headers,
          details: await response.text(),
        });
      },
    })({ ...parameters, timeout, retryCount: 0 }));

    return createTransport({
      key: 'bondrail-rpc', name: 'Paced Bondrail RPC', type: 'bondrail-rpc', retryCount: 0, timeout,
      request: (async (args, options) => {
        let lastError: unknown = new Error(`No RPC supports ${args.method}`);
        for (let index = 0; index < ordered.length; index++) {
          const url = ordered[index];
          if (restrictedMethods.get(url)?.has(args.method)) continue;
          for (let attempt = 0; attempt <= retryCount; attempt++) {
            try {
              return await bucket.run(async () => {
                // A queued caller may have learned a restriction while waiting for its slot.
                const restriction = restrictedMethods.get(url)?.get(args.method);
                if (restriction) throw restriction;
                try { return await transports[index].request(args, { ...options, retryCount: 0 }); }
                catch (error) {
                  if (options?.signal?.aborted) throw error;
                  const { status, message } = errorDetails(error);
                  if (status === 403 && /restricted/i.test(message)) {
                    const methods = restrictedMethods.get(url) ?? new Map<string, unknown>();
                    methods.set(args.method, error);
                    restrictedMethods.set(url, methods);
                  } else if (isTransientRpcError(error)) {
                    // Set cooldown BEFORE releasing the slot, so queued callers cannot jump it.
                    // Equal jitter: [base/2, base), exponential with a five-second cap.
                    const backoff = Math.min(5000, retryDelay * 2 ** attempt) * (0.5 + random() * 0.5);
                    bucket.coolDown(backoff);
                  }
                  throw error;
                }
              });
            } catch (error) {
              lastError = error;
              if (options?.signal?.aborted) throw error;
              const { status, message } = errorDetails(error);
              if (status === 403 && /restricted/i.test(message)) break;
              if (!isTransientRpcError(error)) throw error;
            }
          }
        }
        throw lastError;
      }) as EIP1193RequestFn,
    });
  };
}
