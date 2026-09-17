import { createHash } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import tar from 'tar-stream';
import { SourceError } from './github-api.js';

function bounded(max: number) {
  let bytes = 0;
  return new Transform({ transform(chunk, _encoding, next) {
    bytes += chunk.length;
    next(bytes > max ? new SourceError('Repository archive exceeds the supported download size.', 413) : null, chunk);
  } });
}

/** Stream into memory only; archive paths can never create files or follow symlinks. */
export async function readGitHubArchive(response: Response, files: { path: string; sha: string; size?: number }[]): Promise<Map<string, Buffer>> {
  if (!response.body) throw new SourceError('GitHub archive was empty.', 502);
  const selected = new Map(files.map(file => [file.path, file]));
  const output = new Map<string, Buffer>(); let retained = 0;
  const extract = tar.extract();
  extract.on('entry', (header, stream, next) => {
    const parts = header.name.split('/'); const file = selected.get(parts.slice(1).join('/'));
    const safe = parts.length > 1 && parts.every(part => part !== '..' && part !== '.' && !part.includes('\\') && !part.includes('\0'));
    stream.on('error', error => extract.destroy(error));
    if (!safe || header.type !== 'file' || !file || (header.size || 0) > 5 * 1024 * 1024) {
      stream.resume(); stream.on('end', next); return;
    }
    const chunks: Buffer[] = [];
    stream.on('data', (data: unknown) => {
      const chunk = Buffer.from(data as Uint8Array);
      retained += chunk.length;
      if (retained > 24 * 1024 * 1024) { extract.destroy(new SourceError('Notebook contents exceed the archive memory limit.', 413)); return; }
      chunks.push(chunk);
    });
    stream.on('end', () => {
      const content = Buffer.concat(chunks);
      const sha = createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex');
      // export-ignore/export-subst and LFS archives must not silently change canonical note bytes.
      if (sha === file.sha) output.set(file.sha, content);
      next();
    });
  });
  await pipeline(Readable.fromWeb(response.body as any), bounded(32 * 1024 * 1024), createGunzip(), bounded(128 * 1024 * 1024), extract,
    { signal: AbortSignal.timeout(30000) });
  return output;
}
