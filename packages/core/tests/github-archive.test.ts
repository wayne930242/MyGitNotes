import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import tar from 'tar-stream';
import { readGitHubArchive } from '../src/github-archive.js';

const sha = (text: string) => createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0${text}`).digest('hex');
async function archive(entries: {name: string; content?: string; type?: 'symlink'; linkname?: string}[]) {
  const pack = tar.pack(); const parts: Buffer[] = [];
  const bytes = new Promise<Buffer>((resolve, reject) => { pack.on('data', part => parts.push(part)); pack.on('end', () => resolve(gzipSync(Buffer.concat(parts)))); pack.on('error', reject); });
  for (const entry of entries) pack.entry({name:entry.name, type:entry.type, linkname:entry.linkname}, entry.content || '');
  pack.finalize(); return new Response(await bytes);
}
it('accepts only canonical regular-file bytes from the pinned tree', async () => {
  const response = await archive([
    {name:'root/notes/good.md',content:'exact\r\n'},
    {name:'root/notes/substituted.md',content:'export-subst changed'},
    {name:'root/notes/link.md',type:'symlink',linkname:'/etc/passwd'},
    {name:'root/../notes/traversal.md',content:'bad'},
  ]);
  const selected = [
    {path:'notes/good.md',sha:sha('exact\r\n')}, {path:'notes/substituted.md',sha:sha('original')},
    {path:'notes/link.md',sha:sha('')}, {path:'../notes/traversal.md',sha:sha('bad')},
  ];
  const result = await readGitHubArchive(response, selected);
  expect([...result.keys()]).toEqual([sha('exact\r\n')]);
  expect(result.get(sha('exact\r\n'))!.toString()).toBe('exact\r\n');
});
it('rejects malformed compressed archives instead of returning partial data', async () => {
  await expect(readGitHubArchive(new Response('not a gzip'), [])).rejects.toThrow();
});
