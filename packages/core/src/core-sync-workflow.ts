import fs from 'node:fs';
import { GitHubApi } from './github-api.js';

export const CORE_SYNC_WORKFLOW = 'mygitnotes-core-sync.yml';
export const CORE_SYNC_SECRET = 'MYGITNOTES_CORE_SYNC_TOKEN';
export function coreSyncWorkflow(): string {
  return fs.readFileSync(new URL('../assets/mygitnotes-core-sync.yml', import.meta.url), 'utf8');
}
/** Only the repository's sealed-box ciphertext leaves this process. */
export async function provisionCoreSyncSecret(api: GitHubApi, token: string): Promise<void> {
  const publicKey = await api.json('/actions/secrets/public-key', {}, true);
  const sodium = (await import('libsodium-wrappers')).default;
  await sodium.ready;
  const key = sodium.from_base64(publicKey.key, sodium.base64_variants.ORIGINAL);
  const encrypted = sodium.crypto_box_seal(sodium.from_string(token), key);
  await api.json(`/actions/secrets/${CORE_SYNC_SECRET}`, { method: 'PUT', body: JSON.stringify({ key_id: publicKey.key_id, encrypted_value: sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL) }) }, true);
}
