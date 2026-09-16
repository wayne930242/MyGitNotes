import { AwsV4Signer } from 'aws4fetch';
import { isValidR2Key, r2PreviewType } from './r2-references.js';

export interface R2Settings { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string }

/** Reads R2 settings from deployment environment; returns null when R2 is not configured. */
export function r2SettingsFromEnv(env: NodeJS.ProcessEnv = process.env): R2Settings | null {
  const accountId = env.MYGITNOTES_R2_ACCOUNT_ID, accessKeyId = env.MYGITNOTES_R2_ACCESS_KEY_ID;
  const secretAccessKey = env.MYGITNOTES_R2_SECRET_ACCESS_KEY, bucket = env.MYGITNOTES_R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket };
}

/** Creates a short-lived presigned GET URL; previewable types render inline, others download. */
export async function presignR2Object(settings: R2Settings, key: string, expiresInSeconds = 300): Promise<string> {
  if (!isValidR2Key(key)) throw new Error('Invalid R2 object key: path traversal is prohibited.');
  const { kind, contentType } = r2PreviewType(key);
  const url = new URL(`https://${settings.accountId}.r2.cloudflarestorage.com/${encodeURIComponent(settings.bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`);
  url.searchParams.set('X-Amz-Expires', String(expiresInSeconds));
  url.searchParams.set('response-content-type', contentType);
  const filename = encodeURIComponent(key.split('/').pop() || 'file').replace(/'/g, '%27');
  url.searchParams.set('response-content-disposition', `${kind === 'file' ? 'attachment' : 'inline'}; filename*=UTF-8''${filename}`);
  const signer = new AwsV4Signer({ url: url.toString(), method: 'GET', accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey,
    service: 's3', region: 'auto', signQuery: true });
  return (await signer.sign()).url.toString();
}
