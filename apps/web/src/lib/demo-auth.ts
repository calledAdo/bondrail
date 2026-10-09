import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
export const cookieName = 'slice_demo_session';
const ttl = 30 * 60;
function secret() {
  return process.env.DEMO_ACCESS_CODE || '';
}
export function validCode(code: unknown) {
  if (typeof code !== 'string' || !secret()) return false;
  const a = Buffer.from(code);
  const b = Buffer.from(secret());
  return a.length === b.length && timingSafeEqual(a, b);
}
export function newSession() {
  const body = `${Math.floor(Date.now() / 1000) + ttl}.${randomBytes(16).toString('hex')}`;
  return `${body}.${createHmac('sha256', secret()).update(body).digest('hex')}`;
}
export function validSession(value: string | undefined) {
  if (!value || !secret()) return false;
  const parts = value.split('.');
  if (
    parts.length !== 3 ||
    !/^\d+$/.test(parts[0]) ||
    !/^[a-f0-9]{32}$/.test(parts[1]) ||
    !/^[a-f0-9]{64}$/.test(parts[2])
  )
    return false;
  const expiry = Number(parts[0]);
  if (expiry < Math.floor(Date.now() / 1000) || expiry > Math.floor(Date.now() / 1000) + ttl + 30)
    return false;
  const expected = createHmac('sha256', secret()).update(`${parts[0]}.${parts[1]}`).digest();
  return timingSafeEqual(expected, Buffer.from(parts[2], 'hex'));
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  return (
    !!origin &&
    origin === new URL(request.url).origin &&
    request.headers.get('sec-fetch-site') !== 'cross-site'
  );
}
