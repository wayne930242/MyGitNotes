import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const random = () => randomBytes(32).toString('base64url');

/** The key every record is sealed with, derived from SESSION_SECRET. */
export function sealingKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error('Set SESSION_SECRET to at least 32 random characters.');
  return createHash('sha256').update(secret).digest();
}
export function seal(value: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', sealingKey(), iv);
  return Buffer.concat([iv, cipher.update(JSON.stringify(value)), cipher.final(), cipher.getAuthTag()]).toString('base64url');
}
/** A sealed record holds JSON this server wrote; callers read back the fields they stored. */
// oxlint-disable-next-line no-explicit-any
export type StoredRecord = any;

export function unseal(value: string, secret = sealingKey()): StoredRecord {
  const data = Buffer.from(value, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', secret, data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(-16));
  return JSON.parse(Buffer.concat([decipher.update(data.subarray(12, -16)), decipher.final()]).toString());
}
