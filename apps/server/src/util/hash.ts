import crypto from 'node:crypto';

export function sha1(s: string): string {
  return crypto.createHash('sha1').update(s).digest('hex');
}

export function shortHash(s: string, len = 16): string {
  return sha1(s).slice(0, len);
}

export function hmac(secret: string, s: string): string {
  return crypto.createHmac('sha256', secret).update(s).digest('base64url').slice(0, 22);
}
