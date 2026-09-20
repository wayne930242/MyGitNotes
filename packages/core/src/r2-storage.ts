import { AwsClient, AwsV4Signer } from 'aws4fetch';
import { isValidR2Key, r2PreviewType } from './r2-references.js';

export interface R2Settings {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint?: string;
}
export interface R2Object {
  key: string;
  size: number;
  lastModified: string;
}

/** Reads R2 settings from deployment environment; returns null when R2 is not configured. */
export function r2SettingsFromEnv(env: NodeJS.ProcessEnv = process.env): R2Settings | null {
  const accountId = env.MYGITNOTES_R2_ACCOUNT_ID, accessKeyId = env.MYGITNOTES_R2_ACCESS_KEY_ID;
  const secretAccessKey = env.MYGITNOTES_R2_SECRET_ACCESS_KEY, bucket = env.MYGITNOTES_R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  const endpoint = env.MYGITNOTES_R2_ENDPOINT?.replace(/\/+$/, '');
  return { accountId, accessKeyId, secretAccessKey, bucket, ...(endpoint ? { endpoint } : {}) };
}

function bucketUrl(settings: R2Settings): string {
  return `${settings.endpoint || `https://${settings.accountId}.r2.cloudflarestorage.com`}/${encodeURIComponent(settings.bucket)}`;
}

function objectUrl(settings: R2Settings, key: string): URL {
  if (!isValidR2Key(key)) throw new Error('Invalid R2 object key: path traversal is prohibited.');
  return new URL(`${bucketUrl(settings)}/${key.split('/').map(encodeURIComponent).join('/')}`);
}

async function presign(settings: R2Settings, url: URL, method: 'GET' | 'PUT', expiresInSeconds: number, headers?: Record<string, string>): Promise<string> {
  url.searchParams.set('X-Amz-Expires', String(expiresInSeconds));
  const signer = new AwsV4Signer({ url: url.toString(), method, headers, accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey, service: 's3', region: 'auto', signQuery: true });
  return (await signer.sign()).url.toString();
}

/** Creates a short-lived presigned GET URL; previewable types render inline, others download. */
export async function presignR2Object(settings: R2Settings, key: string, expiresInSeconds = 300, download = false): Promise<string> {
  const url = objectUrl(settings, key);
  const { kind, contentType } = r2PreviewType(key);
  url.searchParams.set('response-content-type', contentType);
  const filename = encodeURIComponent(key.split('/').pop() || 'file').replace(/'/g, '%27');
  url.searchParams.set('response-content-disposition', `${kind === 'file' || download ? 'attachment' : 'inline'}; filename*=UTF-8''${filename}`);
  return presign(settings, url, 'GET', expiresInSeconds);
}

/** Headers a create-only PUT sends; the bucket answers 412 when the key already exists. */
export const R2_CREATE_ONLY_HEADERS = { 'If-None-Match': '*' };

/** Creates a short-lived presigned create-only PUT URL; the browser must send `R2_CREATE_ONLY_HEADERS`. */
export function presignR2Upload(settings: R2Settings, key: string, expiresInSeconds = 900): Promise<string> {
  return presign(settings, objectUrl(settings, key), 'PUT', expiresInSeconds, R2_CREATE_ONLY_HEADERS);
}

const client = (settings: R2Settings) => new AwsClient({ accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey, service: 's3', region: 'auto' });

async function send(settings: R2Settings, url: URL | string, init: RequestInit = {}): Promise<Response> {
  const response = await client(settings).fetch(url.toString(), init);
  if (!response.ok && response.status !== 404 && response.status !== 412) throw new Error(`R2 request failed with status ${response.status}.`);
  return response;
}

const xmlText = (value: string) => value.replace(/&(lt|gt|quot|apos|amp|#(\d+)|#x([0-9a-f]+));/gi, (_, name: string, dec?: string, hex?: string) => dec ? String.fromCodePoint(Number(dec)) : hex ? String.fromCodePoint(parseInt(hex, 16)) : ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' } as Record<string, string>)[name.toLowerCase()]);
const xmlField = (xml: string, name: string) => {
  const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml);
  return match ? xmlText(match[1]) : '';
};

/** Lists every object under `prefix`, following ListObjectsV2 continuation tokens. */
export async function listR2Objects(settings: R2Settings, prefix: string): Promise<R2Object[]> {
  const objects: R2Object[] = [];
  let token = '';
  do {
    const url = new URL(bucketUrl(settings));
    url.searchParams.set('list-type', '2');
    url.searchParams.set('prefix', prefix);
    if (token) url.searchParams.set('continuation-token', token);
    const response = await send(settings, url);
    if (!response.ok) throw new Error(`R2 request failed with status ${response.status}.`);
    const xml = await response.text();
    for (const [, entry] of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      objects.push({ key: xmlField(entry, 'Key'), size: Number(xmlField(entry, 'Size')) || 0, lastModified: xmlField(entry, 'LastModified') });
    }
    token = xmlField(xml, 'IsTruncated') === 'true' ? xmlField(xml, 'NextContinuationToken') : '';
  } while (token);
  return objects;
}

export async function r2ObjectExists(settings: R2Settings, key: string): Promise<boolean> {
  return (await send(settings, objectUrl(settings, key), { method: 'HEAD' })).ok;
}

/** Uploads bytes with a create-only PUT; returns false when the key already exists. */
export async function putR2Object(settings: R2Settings, key: string, body: Uint8Array | string): Promise<boolean> {
  // `BodyInit` pins its buffer type, while a Node `Buffer` carries the looser `ArrayBufferLike`.
  return (await send(settings, objectUrl(settings, key), { method: 'PUT', body: body as BodyInit, headers: R2_CREATE_ONLY_HEADERS })).ok;
}

/** Creates an empty object; returns false when the key already exists. */
export function putEmptyR2Object(settings: R2Settings, key: string): Promise<boolean> {
  return putR2Object(settings, key, '');
}

export async function copyR2Object(settings: R2Settings, source: string, destination: string): Promise<void> {
  const copySource = `/${encodeURIComponent(settings.bucket)}/${objectUrl(settings, source).pathname.split('/').slice(2).join('/')}`;
  const response = await send(settings, objectUrl(settings, destination), { method: 'PUT', headers: { 'x-amz-copy-source': copySource } });
  if (!response.ok) throw new Error(`R2 copy failed with status ${response.status}.`);
}

export async function deleteR2Object(settings: R2Settings, key: string): Promise<void> {
  await send(settings, objectUrl(settings, key), { method: 'DELETE' });
}
