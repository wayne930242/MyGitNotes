import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer, Server } from 'node:http';
import { createApp } from '../src/app.js';
import { SessionStore, seal, unseal } from '../src/auth.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

let root: string; let server: Server; let base: string;
const git = (...args: string[]) => execFileSync('git',args,{cwd:root,stdio:'pipe'});
beforeEach(async () => {
  root=fs.mkdtempSync(path.join(os.tmpdir(),'github-notes-http-'));
  vi.stubEnv('GITHUB_NOTES_SOURCE','local'); vi.stubEnv('GITHUB_NOTES_LOCAL_PATH',root); vi.stubEnv('VERCEL',''); vi.stubEnv('APP_URL','');
  vi.stubEnv('SESSION_SECRET','s'.repeat(64)); vi.stubEnv('UPSTASH_REDIS_REST_URL','');
  git('init','-b','main'); git('config','user.name','Test'); git('config','user.email','test@example.com');
  fs.mkdirSync(path.join(root,'notes/example/projects/deep'),{recursive:true});
  fs.writeFileSync(path.join(root,'notes/.github-notes.yaml'),'schema_version: 1\nworkspace:\n  title: Test\n  default_notebook: example\nnotebooks:\n  - id: example\n    title: Example\n    root: notes/example\n');
  fs.writeFileSync(path.join(root,'notes/example/projects/_dir.yml'),'title: Projects\n');
  fs.writeFileSync(path.join(root,'notes/example/projects/deep/note.md'),'# Note');
  fs.writeFileSync(path.join(root,'.env'),'SECRET=hidden');
  git('add','.'); git('commit','-m','fixture');
  server=createServer(createApp(root)); await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  base=`http://127.0.0.1:${(server.address() as any).port}`;
});
afterEach(async()=>{ await new Promise<void>(resolve=>server.close(()=>resolve())); fs.rmSync(root,{recursive:true,force:true}); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('real HTTP local boundaries',()=>{
  it('uploads into directories, keeps hash URLs after moves, and restricts deletion to assets', async () => {
    const request = (method: string, body: unknown) => ({ method, headers: {'Content-Type':'application/json'}, body:JSON.stringify(body) });
    const uploaded = await fetch(`${base}/api/assets`, request('POST', {notebookId:'example',filename:'test.txt',directory:'projects/images',base64Content:Buffer.from('asset bytes').toString('base64')})).then(r=>r.json());
    expect(uploaded.path).toBe('notes/example/assets/projects/images/test.txt');
    expect(uploaded.rawUrl).toMatch(/^\/raw-assets\/by-hash\/[a-f0-9]{40}$/);
    expect(await fetch(base+uploaded.rawUrl).then(r=>r.text())).toBe('asset bytes');
    const moved = await fetch(`${base}/api/assets`, request('PATCH', {path:uploaded.path,directory:'archive'})).then(r=>r.json());
    expect(moved.path).toBe('notes/example/assets/archive/test.txt');
    expect(await fetch(base+uploaded.rawUrl).then(r=>r.text())).toBe('asset bytes');
    const listed = await fetch(`${base}/api/assets?notebookId=example`).then(r=>r.json());
    expect(listed.assets[0]).toMatchObject({directory:'archive',rawUrl:uploaded.rawUrl});
    expect((await fetch(`${base}/api/assets?path=notes/example/projects/deep/note.md`,{method:'DELETE'})).status).toBe(403);
    expect((await fetch(`${base}/api/assets`, request('POST',{notebookId:'example',filename:'x.png',directory:'../escape',base64Content:'eA=='}))).ok).toBe(false);
    expect((await fetch(`${base}/api/assets?path=${encodeURIComponent(moved.path)}`,{method:'DELETE'})).ok).toBe(true);
    expect((await fetch(base+uploaded.rawUrl)).status).toBe(404);
  });
  it('lists configured folders, creates in nested directories and rejects duplicate creation',async()=>{
    const folders=await fetch(`${base}/api/folders`).then(r=>r.json()); expect(folders.folders.map((f:any)=>f.path)).toEqual(['projects','projects/deep']);
    const request={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:'notes/example/projects/deep/new.md',content:'# New',createOnly:true,noCommit:true})};
    expect((await fetch(`${base}/api/notes`,request)).status).toBe(200);
    expect((await fetch(`${base}/api/notes`,request)).status).toBe(409);
    expect(fs.readFileSync(path.join(root,'notes/example/projects/deep/new.md'),'utf8')).toBe('# New');
  });
  it('blocks raw secret reads, product-file writes, foreign origins and core branch writes',async()=>{
    expect((await fetch(`${base}/raw-assets/.env`)).status).toBe(403);
    expect((await fetch(`${base}/api/notes/read?path=.env`)).status).toBe(403);
    expect((await fetch(`${base}/api/notes`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:'README.md',content:'bad'})})).status).toBe(403);
    expect((await fetch(`${base}/api/workspace`,{headers:{Origin:'https://evil.example'}})).status).toBe(403);
    git('checkout','-b','core');
    expect((await fetch(`${base}/api/notes`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:'notes/example/new.md',content:'bad'})})).status).toBe(403);
  });
  it('rejects OAuth callbacks without matching browser state and unauthenticated agent grants',async()=>{
    expect((await fetch(`${base}/api/auth/github/callback?state=${'x'.repeat(43)}&code=x`)).status).toBe(400);
    expect((await fetch(`${base}/api/auth/agent-token`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status).toBe(401);
    expect((await fetch(`${base}/mcp`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status).toBe(503);
  });
});
describe('server-held session records',()=>{
  it('encrypts upstream tokens and detects tampering',async()=>{
    const record=seal({token:'upstream-secret'}); expect(record).not.toContain('upstream-secret'); expect(unseal(record).token).toBe('upstream-secret');
    const bytes=Buffer.from(record,'base64url');bytes[15]^=1;expect(()=>unseal(bytes.toString('base64url'))).toThrow();
    const store=new SessionStore(root);const id='a'.repeat(43);await store.set(id,{kind:'session',token:'upstream-secret'});
    expect((await store.get(id)).token).toBe('upstream-secret');await store.delete(id);expect(await store.get(id)).toBe(null);
  });
});

describe('GitHub login and shared agent authorization',()=>{
  it('completes PKCE login, keeps credentials server-side, protects private reads and preserves persistent grants until owner revocation',async()=>{
    await new Promise<void>(resolve=>server.close(()=>resolve()));
    vi.stubEnv('GITHUB_NOTES_SOURCE','github');vi.stubEnv('GITHUB_NOTES_REPOSITORY','owner/repo');vi.stubEnv('GITHUB_NOTES_BRANCH','main');
    vi.stubEnv('GITHUB_CLIENT_ID','client');vi.stubEnv('GITHUB_CLIENT_SECRET','client-secret');
    server=createServer(createApp(root));await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    base=`http://127.0.0.1:${(server.address() as any).port}`;vi.stubEnv('APP_URL',base);
    const nativeFetch=globalThis.fetch;
    const manifest='schema_version: 1\nworkspace:\n  title: Private\n  default_notebook: ex\nnotebooks:\n  - id: ex\n    title: Example\n    root: notes/ex\n';
    const mock=vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
      const url=String(input);const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
      if(url==='https://github.com/login/oauth/access_token') {
        const body=JSON.parse(String(init?.body));expect(body.code_verifier).toHaveLength(43);expect(body.redirect_uri).toBe(`${base}/api/auth/github/callback`);
        return json({access_token:'private-upstream-token'});
      }
      if(url==='https://api.github.com/user')return json({id:1,login:'owner'});
      if(url.startsWith('https://api.github.com/repos/owner/repo')) {
        if(!(init?.headers as any)?.Authorization)return json({},404);
        const endpoint=url.replace('https://api.github.com/repos/owner/repo','');
        if(!endpoint)return json({private:true,permissions:{push:true}});
        if(endpoint.startsWith('/commits/'))return json({sha:'head',commit:{tree:{sha:'tree'}}});
        if(endpoint.startsWith('/git/trees/'))return json({truncated:false,tree:[{path:'notes/.github-notes.yaml',sha:'manifest',type:'blob',mode:'100644'},{path:'notes/ex/private.md',sha:'note',type:'blob',mode:'100644'}]});
        if(endpoint.startsWith('/git/blobs/'))return json({encoding:'base64',content:Buffer.from(endpoint.endsWith('manifest')?manifest:'# Private Note').toString('base64')});
      }
      return nativeFetch(input,init);
    });
    try {
      expect((await fetch(`${base}/api/notes`)).status).toBe(404);
      expect((await fetch(`${base}/api/notes/commit`, {method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status).toBe(403);
      const start=await fetch(`${base}/api/auth/github`,{redirect:'manual'});
      expect(start.status).toBe(302);const location=new URL(start.headers.get('location')!);
      expect(location.searchParams.get('code_challenge_method')).toBe('S256');expect(location.searchParams.get('scope')).toBe('repo');
      const oauthCookie=start.headers.get('set-cookie')!.split(';')[0];
      const callback=await fetch(`${base}/api/auth/github/callback?state=${location.searchParams.get('state')}&code=test`,{redirect:'manual',headers:{Cookie:oauthCookie}});
      expect(callback.status).toBe(302);
      const sessionHeader=callback.headers.getSetCookie().find(value=>value.startsWith('gh_notes_session='))!;
      expect(sessionHeader).toContain('HttpOnly');expect(sessionHeader).not.toContain('private-upstream-token');const cookie=sessionHeader.split(';')[0];
      const notes=await fetch(`${base}/api/notes`,{headers:{Cookie:cookie}}).then(r=>r.json());expect(notes.notes[0].title).toBe('Private Note');
      const grantResponse=await fetch(`${base}/api/auth/agent-token`,{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({write:false})});
      const grant=await grantResponse.json();expect(grant.expiresIn).toBeNull();expect(grant.url).toBe(`${base}/mcp/${grant.token}`);expect(grant.token).toHaveLength(43);expect(grant.token).not.toBe('private-upstream-token');
      const call={method:'POST',headers:{Connection:'close',Authorization:`Bearer ${grant.token}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})};
      const listed=await fetch(`${base}/mcp`,call);expect(listed.status).toBe(200);expect(listed.headers.get('cache-control')).toBe('private, no-store');const listedBody=await listed.json();expect(listedBody.result.tools.some((t:any)=>t.name==='save_note')).toBe(false);
      const urlCall = {...call,headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream',Connection:'close'}};
      const viaUrl=await fetch(grant.url,urlCall);expect(viaUrl.status).toBe(200);expect(viaUrl.headers.get('cache-control')).toBe('private, no-store');
      const client = new Client({name:'connector-schema-test',version:'1.0.0'});
      await client.connect(new StreamableHTTPClientTransport(new URL(grant.url)));
      try {
        const { tools } = await client.listTools();
        expect(tools.map(t => t.name)).toEqual(expect.arrayContaining(['ls','glob','read','find','get_statuses','read_note','search_notes']));
        expect(tools.every(t => t.annotations?.readOnlyHint === true && t.inputSchema && t.outputSchema)).toBe(true);
        for (const name of ['write','append','edit','mkdir','cp','mv','rm','save_note','delete_note','add_asset','delete_asset','replace_notes','update_note_metadata']) expect(tools.some(t => t.name === name)).toBe(false);
        // The SDK validates structuredContent against each advertised output schema.
        for (const [name, args] of [['read', {path:'notes/ex/private.md'}], ['glob',{}], ['find',{query:'Private'}], ['read_note',{path:'notes/ex/private.md'}], ['get_statuses',{}], ['get_note_metadata',{path:'notes/ex/private.md'}], ['search_notes',{query:'Private'}]] as const) {
          const result = await client.callTool({name,arguments:args});
          expect(result.isError).not.toBe(true); expect(result.structuredContent).toBeDefined();
        }
      } finally { await client.close(); }
      const denied=await fetch(`${base}/mcp`,{...call,body:JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'save_note',arguments:{path:'notes/ex/private.md',content:'bad',revision:'head'}}})}).then(r=>r.json());expect(denied.result.isError).toBe(true);
      const store = new SessionStore(root);
      const grants = await fetch(`${base}/api/auth/agent-tokens`, {headers:{Cookie:cookie}}).then(r=>r.json());
      expect(grants.grants[0]).toMatchObject({id:grant.id,write:false,expiresAt:null});
      expect(JSON.stringify(grants)).not.toContain(grant.token);
      expect(JSON.stringify(grants)).not.toContain('private-upstream-token');
      const legacy='l'.repeat(43);
      await store.set(legacy,{kind:'agent',session:cookie.split('=')[1],source:'github:owner/repo@main',audience:`${base}/mcp`,write:false},8*3600);
      const legacyCall={...call,headers:{...call.headers,Authorization:`Bearer ${legacy}`}};
      expect((await fetch(`${base}/mcp`,legacyCall)).status).toBe(200);
      await fetch(`${base}/api/auth/logout`,{method:'POST',headers:{Cookie:cookie}});
      expect((await fetch(`${base}/mcp`,call)).status).toBe(200);
      expect((await fetch(`${base}/mcp`,legacyCall)).status).toBe(401);
      expect((await fetch(`${base}/api/notes`,{headers:{Cookie:cookie}})).status).toBe(404);
      const now=Date.now();vi.spyOn(Date,'now').mockReturnValue(now+31*24*3600*1000);
      await new Promise<void>(resolve=>server.close(()=>resolve()));
      server=createServer(createApp(root));await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
      base=`http://127.0.0.1:${(server.address() as any).port}`;
      const stillReadable=await fetch(`${base}/mcp`,{...call,body:JSON.stringify({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'read_note',arguments:{path:'notes/ex/private.md'}}})}).then(r=>r.json());
      expect(stillReadable.result.isError).not.toBe(true);
      expect(stillReadable.result.content[0].text).toContain('Private Note');
      const other='o'.repeat(43);await store.set(other,{kind:'session',userId:2,token:'other-token'});
      expect((await fetch(`${base}/api/auth/agent-tokens/${grant.id}`,{method:'DELETE',headers:{Cookie:`gh_notes_session=${other}`}})).status).toBe(404);
      expect((await fetch(`${base}/mcp`,call)).status).toBe(200);
      const owner='n'.repeat(43);await store.set(owner,{kind:'session',userId:1,token:'private-upstream-token'});
      expect((await fetch(`${base}/api/auth/agent-tokens/${grant.id}`,{method:'DELETE',headers:{Cookie:`gh_notes_session=${owner}`}})).status).toBe(200);
      expect((await fetch(`${base}/mcp`,call)).status).toBe(401);
      expect((await fetch(`${base}/mcp/${grant.token}`,urlCall)).status).toBe(401);
      expect((await fetch(`${base}/api/auth/agent-tokens`,{headers:{Cookie:`gh_notes_session=${owner}`}}).then(r=>r.json())).grants).toEqual([]);
    } finally {mock.mockRestore();}
  });
});


describe('durable Redis grant records',()=>{
  it('stores grants without TTL and removes the owner index on revocation',async()=>{
    vi.stubEnv('UPSTASH_REDIS_REST_URL','https://redis.test');vi.stubEnv('UPSTASH_REDIS_REST_TOKEN','redis-token');
    const records=new Map<string,string>();const members=new Set<string>();const commands:string[][]=[];
    vi.spyOn(globalThis,'fetch').mockImplementation(async(_input,init)=>{
      const c=JSON.parse(String(init?.body));commands.push(c);let result:unknown=null;
      if(c[0]==='SET'){records.set(c[1],c[2]);result='OK';}
      if(c[0]==='GET')result=records.get(c[1])||null;
      if(c[0]==='DEL'){records.delete(c[1]);result=1;}
      if(c[0]==='SADD'){members.add(c[2]);result=1;}
      if(c[0]==='SREM'){members.delete(c[2]);result=1;}
      if(c[0]==='SMEMBERS')result=[...members];
      return new Response(JSON.stringify({result}));
    });
    const store=new SessionStore(root);const token='t'.repeat(43);
    await store.set(token,{kind:'agent',ownerId:1,name:'Test',createdAt:Date.now(),write:false,source:'github:owner/repo@main'},null);await store.indexGrant(token,1);
    expect(commands.find(c=>c[0]==='SET')).toHaveLength(3);
    expect([...records.values()][0]).not.toContain('ownerId');
    const grants=await store.listGrants(1);expect(grants).toHaveLength(1);
    expect(await store.revokeGrant(grants[0].id,2)).toBe(false);
    expect(await store.revokeGrant(grants[0].id,1)).toBe(true);
    expect(await store.get(token)).toBeNull();expect(members.size).toBe(0);
    await store.set(token,{kind:'oauth'},600);expect(commands.filter(c=>c[0]==='SET').at(-1)?.slice(-2)).toEqual(['EX','600']);
  });
  it('self-heals and prunes undecryptable records when session secret is rotated', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.test');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'redis-token');
    const records = new Map<string, string>();
    const members = new Set<string>();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const c = JSON.parse(String(init?.body));
      let result: unknown = null;
      if (c[0] === 'GET') result = records.get(c[1]) || null;
      if (c[0] === 'DEL') { records.delete(c[1]); result = 1; }
      if (c[0] === 'SREM') { members.delete(c[2]); result = 1; }
      if (c[0] === 'SMEMBERS') result = [...members];
      return new Response(JSON.stringify({ result }));
    });
    const hash = 'a'.repeat(64);
    records.set(`gh-notes:${hash}`, 'invalid-ciphertext-or-old-key-data');
    members.add(hash);
    const store = new SessionStore(root);
    const grants = await store.listGrants(1);
    expect(grants).toEqual([]);
    expect(records.has(`gh-notes:${hash}`)).toBe(false);
    expect(members.has(hash)).toBe(false);
  });
});

describe('agent resources discovery and security boundaries', () => {
  it('discovers system and workspace guidelines, allows reading root AGENTS.md, and rejects modifying non-notes resources', async () => {
    fs.writeFileSync(path.join(root, 'AGENTS.md'), '# Product System Guidelines\n');
    fs.writeFileSync(path.join(root, 'notes/AGENTS.md'), '# Workspace Guidelines\n');

    const res = await fetch(`${base}/api/agent-resources`).then((r) => r.json());
    expect(res.instructions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'AGENTS.md', scope: 'product', editable: false }),
        expect.objectContaining({ path: 'notes/AGENTS.md', scope: 'notes', editable: true }),
      ])
    );

    const rootDoc = await fetch(`${base}/api/agent-resources/read?path=AGENTS.md`).then((r) => r.json());
    expect(rootDoc.content).toBe('# Product System Guidelines\n');

    const saveRoot = await fetch(`${base}/api/agent-resources/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'AGENTS.md', content: 'attempted overwrite' }),
    });
    expect(saveRoot.status).toBe(403);

    const saveWorkspace = await fetch(`${base}/api/agent-resources/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'notes/AGENTS.md', content: '# Updated Workspace Guidelines\n' }),
    });
    expect(saveWorkspace.status).toBe(200);
    expect(fs.readFileSync(path.join(root, 'notes/AGENTS.md'), 'utf8')).toBe('# Updated Workspace Guidelines\n');
  });
});
