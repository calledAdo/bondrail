import { createHash, timingSafeEqual } from 'node:crypto';
export function authorized(header: string | null | undefined, secret: string | undefined): boolean {
  if (!secret || secret.length < 32 || !header?.startsWith('Bearer ')) return false;
  const h = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(new Uint8Array(h(header.slice(7))), new Uint8Array(h(secret)));
}
