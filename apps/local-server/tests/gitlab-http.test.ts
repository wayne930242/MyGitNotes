import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import { createApp } from '../src/app.js';
import { SessionStore, credentialToken } from '../src/auth.js';
import { gitlabFixture } from '../../../packages/core/tests/fixtures/gitlab.js';

let root:string, server:Server, base:string, fixture:ReturnType<typeof gitlabFixture>, refreshes:number, cookie:string;
const site='https://gitlab.example.test/gitlab';
const nativeFetch=globalThis.fetch;
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const post=(body:unknown, auth=cookie)=>({method:'POST',headers:{Cookie:auth,'Content-Type':'application/json'},body:JSON.stringify(body)});
async function login() {
  const start=await fetch(`${base}/api/auth/gitlab`,{redirect:'manual'});expect(start.status).toBe(302);
  const target=new URL(start.headers.get('location')!);expect(target.origin+target.pathname).toBe(`${site}/oauth/authorize`);
  expect(target.searchParams.get('scope')).toBe('api');expect(target.searchParams.get('response_type')).toBe('code');expect(target.searchParams.get('code_challenge_method')).toBe('S256');
  const oauthCookie=start.headers.get('set-cookie')!.split(';')[0];
  const callback=await fetch(`${base}/api/auth/gitlab/callback?state=${target.searchParams.get('state')}&code=fixture`,{redirect:'manual',headers:{Cookie:oauthCookie}});
  expect(callback.status).toBe(302);
  const session=callback.headers.getSetCookie().find(s=>s.startsWith('gh_notes_session='))!;expect(session).toContain('HttpOnly');expect(session).not.toContain('fixture-token');
  cookie=session.split(';')[0];
  return {state:target.searchParams.get('state'),oauthCookie};
}
beforeEach(async()=>{
  root=fs.mkdtempSync(path.join(os.tmpdir(),'mygitnotes-gitlab-'));refreshes=0;cookie='';fixture=gitlabFixture(site);
  for(const [key,value] of Object.entries({GITHUB_NOTES_SOURCE:'gitlab',GITHUB_NOTES_REPOSITORY:'group/subgroup/project',GITHUB_NOTES_BRANCH:'main',GITLAB_URL:site,GITLAB_CLIENT_ID:'fixture-client',GITLAB_CLIENT_SECRET:'fixture-secret',SESSION_SECRET:'s'.repeat(64),VERCEL:'',UPSTASH_REDIS_REST_URL:'',APP_URL:''})) vi.stubEnv(key,value);
  server=createServer(createApp(root));await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${(server.address() as any).port}`;vi.stubEnv('APP_URL',base);
  vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
    const url=String(input);
    if(url===`${site}/oauth/token`) {
      const body=JSON.parse(String(init?.body));expect(body.client_id).toBe('fixture-client');expect(body.redirect_uri).toBe(`${base}/api/auth/gitlab/callback`);expect(init?.redirect).toBe('error');
      if(body.grant_type==='refresh_token') {refreshes++;expect(body.refresh_token).toBe('fixture-refresh');return json({access_token:'refreshed-token',refresh_token:'rotated-refresh',expires_in:7200});}
      expect(body.grant_type).toBe('authorization_code');expect(body.code_verifier).toHaveLength(43);
      return json({access_token:'fixture-token',refresh_token:'fixture-refresh',expires_in:7200});
    }
    if(url===`${site}/api/v4/user`)return json({id:42,username:'example'});
    if(url.startsWith(`${site}/api/v4/projects/`))return fixture.request(input,init);
    if(url.startsWith(base))return nativeFetch(input,init);
    throw new Error('Unexpected outbound request');
  });
});
afterEach(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));fs.rmSync(root,{recursive:true,force:true});vi.unstubAllEnvs();vi.restoreAllMocks();});

describe('GitLab HTTP and MCP integration',()=>{
  it('pins OAuth to the configured provider and site, requires state, consumes callbacks once and isolates sessions',async()=>{
    expect(await fetch(`${base}/api/auth/session`).then(r=>r.json())).toMatchObject({provider:'gitlab',loginUrl:'/api/auth/gitlab',authenticated:false,configured:true});
    expect((await fetch(`${base}/api/auth/github`,{redirect:'manual'})).status).toBe(404);
    expect((await fetch(`${base}/api/auth/gitlab/callback?state=${'x'.repeat(43)}&code=x`)).status).toBe(400);
    const {state,oauthCookie}=await login();
    expect((await fetch(`${base}/api/auth/gitlab/callback?state=${state}&code=fixture`,{redirect:'manual',headers:{Cookie:oauthCookie}})).status).toBe(400);
    expect(await fetch(`${base}/api/auth/session`,{headers:{Cookie:cookie}}).then(r=>r.json())).toMatchObject({authenticated:true,login:'example'});
    vi.stubEnv('GITLAB_URL','https://another.example.test');
    expect(await fetch(`${base}/api/auth/session`,{headers:{Cookie:cookie}}).then(r=>r.json())).toMatchObject({authenticated:false});
  });
  it('reads private workspace notes, commits changes and exposes GitLab capabilities',async()=>{
    expect((await fetch(`${base}/api/notes`)).status).toBe(404);await login();
    const workspace=await fetch(`${base}/api/workspace`,{headers:{Cookie:cookie}}).then(r=>r.json());
    expect(workspace).toMatchObject({source:{type:'gitlab'},capabilities:{write:true,local:false}});
    const notes=await fetch(`${base}/api/notes`,{headers:{Cookie:cookie}}).then(r=>r.json());expect(notes.notes).toHaveLength(2);
    const note=notes.notes.find((n:any)=>n.title==='Alpha');
    const saved=await fetch(`${base}/api/notes/commit`,post({notes:[{...note,content:'# Updated'}],revision:fixture.head,message:'docs: edit note'}));expect(saved.status).toBe(200);expect(fixture.writes).toBe(1);
    expect(await fetch(`${base}/api/screen-page`,{headers:{Cookie:cookie}}).then(r=>r.json())).toMatchObject({writable:true,page:{version:1}});
    expect(await fetch(`${base}/api/study`,{headers:{Cookie:cookie}}).then(r=>r.json())).toMatchObject({writable:true});
    expect((await fetch(`${base}/api/agent-resources`,{headers:{Cookie:cookie}}).then(r=>r.json())).instructions[0].path).toBe('AGENTS.md');
  });
  it('refreshes one shared credential for concurrent browser/MCP calls and preserves grants after logout until revocation',async()=>{
    await login();const store=new SessionStore(root),session=await store.get(cookie.split('=')[1]);
    const grant=await fetch(`${base}/api/auth/agent-token`,post({name:'reader',write:false})).then(r=>r.json());
    const credential=await store.get(session.credential);await store.set(session.credential,{...credential,upstreamExpiresAt:Date.now()-1000},null);
    expect(await Promise.all([credentialToken(root,session.credential),credentialToken(root,session.credential)])).toEqual(['refreshed-token','refreshed-token']);expect(refreshes).toBe(1);
    expect((await store.get(session.credential)).refreshToken).toBe('rotated-refresh');
    const mcp=(method:string,params?:unknown)=>({method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
    const listing=await fetch(grant.url,mcp('tools/list')).then(r=>r.json());expect(listing.result.tools.some((t:any)=>t.name==='write')).toBe(false);
    expect((await fetch(grant.url,mcp('tools/call',{name:'read',arguments:{path:'notes/ex/a.md'}})).then(r=>r.json())).result.isError).not.toBe(true);
    expect((await fetch(grant.url,mcp('tools/call',{name:'write',arguments:{path:'notes/ex/a.md',content:'bad',revision:fixture.head}})).then(r=>r.json())).result.isError).toBe(true);
    await fetch(`${base}/api/auth/logout`,post({}));expect((await fetch(grant.url,mcp('tools/list'))).status).toBe(200);
    await login();const grants=await fetch(`${base}/api/auth/agent-tokens`,{headers:{Cookie:cookie}}).then(r=>r.json());expect(grants.grants[0].id).toBe(grant.id);
    expect(JSON.stringify(grants)).not.toContain(grant.token);expect(JSON.stringify(grants)).not.toContain('fixture-token');
    expect((await fetch(`${base}/api/auth/agent-tokens/${grant.id}`,{method:'DELETE',headers:{Cookie:cookie}})).status).toBe(200);
    expect((await fetch(grant.url,mcp('tools/list'))).status).toBe(401);
  });
  it('executes a write grant through MCP and rejects cross-site credential reuse',async()=>{
    await login();const grant=await fetch(`${base}/api/auth/agent-token`,post({write:true})).then(r=>r.json());
    const response=await fetch(grant.url,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'write',arguments:{path:'notes/ex/new.md',content:'# Created via MCP',revision:fixture.head}}})}).then(r=>r.json());
    expect(response.result.isError).not.toBe(true);expect(fixture.files.get('notes/ex/new.md')).toBe('# Created via MCP');
    const store=new SessionStore(root),session=await store.get(cookie.split('=')[1]);vi.stubEnv('GITLAB_URL','https://different.example.test');
    await expect(credentialToken(root,session.credential)).rejects.toMatchObject({status:401});
  });
});

it('serializes hosted refresh across independent local lock scopes using Redis and reports refresh failure',async()=>{
  vi.stubEnv('UPSTASH_REDIS_REST_URL','https://redis.example.test');
  const values=new Map<string,string>(),sets=new Map<string,Set<string>>();
  vi.spyOn(SessionStore.prototype,'command').mockImplementation(async ([command,key,...args])=>{
    if(command==='GET')return values.get(key)??null;
    if(command==='SET'){if(args.includes('NX')&&values.has(key))return null;values.set(key,args[0]);return 'OK';}
    if(command==='DEL')return Number(values.delete(key));
    if(command==='SADD'){const set=sets.get(key)||new Set();set.add(args[0]);sets.set(key,set);return 1;}
    if(command==='SMEMBERS')return [...(sets.get(key)||[])];
    if(command==='EVAL'){const lock=args[1],nonce=args[2];if(values.get(lock)===nonce)return Number(values.delete(lock));return 0;}
    throw new Error('Unexpected Redis command');
  });
  await login();const store=new SessionStore(root),session=await store.get(cookie.split('=')[1]),record=await store.get(session.credential);
  await store.set(session.credential,{...record,upstreamExpiresAt:Date.now()-1000},null);
  expect(await Promise.all([credentialToken(root,session.credential),credentialToken(root+'-other-process',session.credential)])).toEqual(['refreshed-token','refreshed-token']);
  expect(refreshes).toBe(1);expect([...values.keys()].some(key=>key.startsWith('gh-notes:refresh:'))).toBe(false);
  await store.set(session.credential,{...record,refreshToken:undefined,upstreamExpiresAt:Date.now()-1000},null);
  await expect(credentialToken(root,session.credential)).rejects.toMatchObject({status:401});
});
