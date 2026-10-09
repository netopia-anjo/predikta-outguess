import { createHmac, timingSafeEqual } from 'node:crypto';

export type TokenKind = 'player' | 'staff' | 'tv';
export function signToken(id: string, expires: number, kind: TokenKind, secret: string) {
  const body = Buffer.from(JSON.stringify({ id, expires, kind })).toString('base64url');
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}
export function verifyToken(token: string, kind: TokenKind, secret: string, now: number): string | null {
  try {
    const [body, signature, extra] = token.split('.');
    if (!body || !signature || extra) return null;
    const actual = Buffer.from(signature, 'base64url');
    const expected = createHmac('sha256', secret).update(body).digest();
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const data = JSON.parse(Buffer.from(body, 'base64url').toString());
    return data.kind === kind && Number.isSafeInteger(data.expires) && data.expires > now &&
      typeof data.id === 'string' && /^[0-9a-f-]{36}$/i.test(data.id) ? data.id : null;
  } catch { return null; }
}
export function pinMatches(a: string, b: string, secret: string) {
  return timingSafeEqual(createHmac('sha256', secret).update(a).digest(), createHmac('sha256', secret).update(b).digest());
}
