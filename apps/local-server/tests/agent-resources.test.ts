import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import { createApp } from '../src/app.js';
import { SessionStore } from '../src/auth.js';

let root: string, server: Server, base: string;
let writes: {endpoint:string;body:any}[];
const files: Record<string,string> = {
  '.github-notes.yaml': 'schema_version: 1\nworkspace:\n  title: Test\n  default_notebook: ex\nnotebooks:\n  - id: ex\n    title: Example\n    root: notes/ex\n',
  'AGENTS.md': '# Workspace\n', '.agents/skills/custom/SKILL.md': '# Skill\n',
  '.codex/agents/reviewer.toml': 'description = "Reviewer"\n', '.codex/auth.json': '{"token":"fixture"}',
};
const session = 'a'.repeat(43);
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(),'github-notes-remote-agents-')); writes = [];
  for (const [key,value] of Object.entries({GITHUB_NOTES_SOURCE:'github',GITHUB_NOTES_REPOSITORY:'agent/http',GITHUB_NOTES_BRANCH:'main',SESSION_SECRET:'s'.repeat(64),UPSTASH_REDIS_REST_URL:'',APP_URL:'',VERCEL:''})) vi.stubEnv(key,value);
  await new SessionStore(root).set(session,{kind:'session',token:'fixture-owner',userId:1});
  const nativeFetch = globalThis.fetch;
  vi.spyOn(globalThis,'fetch').mockImplementation(async (url,init) => {
    if (!String(url).startsWith('https://api.github.com/repos/agent/http')) return nativeFetch(url,init);
    const endpoint = String(url).replace('https://api.github.com/repos/agent/http','');
    if (init?.method) writes.push({endpoint,body:JSON.parse(String(init.body))});
    const value = endpoint === '' ? {private:false,permissions:{push:true}}
      : endpoint.startsWith('/commits/') ? {sha:'before',commit:{tree:{sha:'tree'}}}
      : endpoint.startsWith('/git/trees/tree?') ? {truncated:false,tree:Object.keys(files).map(file=>({path:file,sha:file,type:'blob',mode:'100644'}))}
      : endpoint.startsWith('/git/blobs/') ? {encoding:'base64',content:Buffer.from(files[endpoint.slice('/git/blobs/'.length)] || '').toString('base64')}
      : endpoint === '/git/trees' ? {sha:'updated-tree'} : endpoint === '/git/commits' ? {sha:'after'} : {};
    return new Response(JSON.stringify(value),{status:200});
  });
  server=createServer(createApp(root)); await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  base=`http://127.0.0.1:${(server.address() as any).port}`;
});
afterEach(async () => { await new Promise<void>(resolve=>server.close(()=>resolve())); fs.rmSync(root,{recursive:true,force:true}); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it('serves workspace Agent settings with revision and enforces login for remote saves',async () => {
  const anonymous=await fetch(`${base}/api/agent-resources`).then(r=>r.json());
  expect(anonymous.instructions).toContainEqual(expect.objectContaining({path:'AGENTS.md',scope:'workspace',editable:false}));
  const headers={Cookie:`gh_notes_session=${session}`,'Content-Type':'application/json'};
  const listing=await fetch(`${base}/api/agent-resources`,{headers}).then(r=>r.json());
  expect(listing.revision).toBe('before');
  expect(listing.instructions).toContainEqual(expect.objectContaining({path:'AGENTS.md',scope:'workspace',editable:true}));
  expect(listing.skills).toContainEqual(expect.objectContaining({path:'.agents/skills/custom/SKILL.md',editable:true}));
  expect(listing.docs.map((r:any)=>r.path)).toEqual(['.codex/agents/reviewer.toml']);
  expect(await fetch(`${base}/api/agent-resources/read?path=AGENTS.md`,{headers}).then(r=>r.json())).toMatchObject({content:'# Workspace\n',revision:'before'});
  expect((await fetch(`${base}/api/agent-resources/read?path=.codex/auth.json`,{headers})).status).toBe(403);
  const body=JSON.stringify({path:'AGENTS.md',content:'# Updated\n',revision:'before'});
  expect((await fetch(`${base}/api/agent-resources/save`,{method:'POST',headers:{'Content-Type':'application/json'},body})).status).toBe(403);
  expect((await fetch(`${base}/api/agent-resources/save`,{method:'POST',headers,body:JSON.stringify({path:'AGENTS.md',content:'bad',revision:'stale'})})).status).toBe(409);
  expect(writes).toEqual([]);
  const saved=await fetch(`${base}/api/agent-resources/save`,{method:'POST',headers,body}).then(r=>r.json());
  expect(saved).toMatchObject({success:true,path:'AGENTS.md',revision:'after',committed:true});
  expect(writes.find(w=>w.endpoint==='/git/trees')?.body.tree).toEqual([{path:'AGENTS.md',mode:'100644',type:'blob',content:'# Updated\n'}]);
});

it('saves Screen YAML as one remote file with authentication and revision protection', async () => {
  const headers = { Cookie: `gh_notes_session=${session}`, 'Content-Type': 'application/json' };
  const page = { version: 1, rows: [{ id: 'lane', name: 'Reading', view: 'small', kind: 'custom', items: [
    { id: 'pin', kind: 'note', notebookId: 'ex', path: 'notes/ex/read.md' },
  ] }] };
  expect(await fetch(`${base}/api/screen-page`).then(r => r.json())).toMatchObject({ writable: false, page: { version: 1, rows: [] } });
  expect(await fetch(`${base}/api/screen-page`, { headers }).then(r => r.json())).toMatchObject({ writable: true, revision: 'before' });
  const put = (revision: string, authenticated = true) => fetch(`${base}/api/screen-page`, { method: 'PUT', headers: authenticated ? headers : { 'Content-Type': 'application/json' }, body: JSON.stringify({ page, revision }) });
  expect((await put('before', false)).status).toBe(403);
  expect((await put('stale')).status).toBe(409);
  expect(writes).toEqual([]);
  const saved = await put('before'); expect(saved.status).toBe(200);
  expect(await saved.json()).toMatchObject({ page, revision: 'after' });
  expect(writes.find(w => w.endpoint === '/git/trees')?.body.tree).toEqual([
    { path: '.github-notes-screen.yaml', mode: '100644', type: 'blob', content: expect.stringContaining('notebookId: ex') },
  ]);
  expect(writes.find(w => w.endpoint === '/git/refs/heads/main')?.body.force).toBe(false);
});
