import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import https from 'node:https';
import http from 'node:http';
import type { FetchedResponse, WatchPolicy } from './protocol';

export function publicAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const p = ip.split('.').map(Number),
      a = p[0]!,
      b = p[1]!,
      c = p[2]!;
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0 || b === 2)) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  // Accept only global-unicast IPv6; deny transition, benchmarking and documentation ranges.
  if (isIP(ip) === 6) {
    const normalized = ip.toLowerCase();
    return (
      /^[23][0-9a-f]{3}:/.test(normalized) &&
      !/^2001:(?:0*:|0?db8:|0?2:|0?1[0-9a-f]:)/.test(normalized) &&
      !normalized.startsWith('2002:') &&
      !normalized.startsWith('3fff:')
    );
  }
  return false;
}
export function validateURL(value: string, local = false): URL {
  const u = new URL(value);
  if (u.username || u.password || u.hash) throw new Error('URL credentials/fragments forbidden');
  const fixture = local && u.protocol === 'http:' && u.hostname === '127.0.0.1' && u.port === '3001';
  if (!fixture && (u.protocol !== 'https:' || (u.port && u.port !== '443')))
    throw new Error('Only HTTPS port 443 is supported');
  return u;
}
/** One pinned, bounded GET: status, the PAYMENT-REQUIRED header and the body (for the manifest). */
export async function fetchURL(url: string, p: WatchPolicy, local = false): Promise<FetchedResponse> {
  const u = validateURL(url, local),
    fixture = local && u.protocol === 'http:';
  const addresses = await lookup(u.hostname.replace(/^\[|\]$/g, ''), {
    all: true,
    verbatim: true,
  });
  if (!addresses.length || (!fixture && addresses.some((x) => !publicAddress(x.address))))
    throw new Error('Unsafe DNS resolution');
  const selected = addresses[0]!;
  return await new Promise((resolve, reject) => {
    let bytes = 0;
    const transport = fixture ? http : https;
    const req = transport.request(
      u,
      {
        method: p.method,
        headers: p.headers,
        agent: false,
        maxHeaderSize: 24576,
        // Pin the validated address for this connection, closing the DNS-rebinding gap.
        // Newer Node calls lookup with { all: true } and expects an address list back.
        lookup: ((_host: unknown, opts: { all?: boolean } | undefined, cb: (...args: unknown[]) => void) =>
          opts?.all
            ? cb(null, [{ address: selected.address, family: selected.family }])
            : cb(null, selected.address, selected.family)) as never,
      },
      (res) => {
        const values = res.headersDistinct['payment-required'];
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 65536) req.destroy(new Error('Response exceeds limit'));
          else chunks.push(chunk);
        });
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            header: values?.length === 1 ? values[0] : undefined,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
        res.on('error', reject);
      },
    );
    const timer = setTimeout(() => req.destroy(new Error('Observation timeout')), 8000);
    req.on('close', () => clearTimeout(timer));
    req.on('error', reject);
    req.end();
  });
}
