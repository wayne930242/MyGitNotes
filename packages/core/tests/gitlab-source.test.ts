import { describe, it, expect } from 'vitest';
import { GitLabSource } from '../src/gitlab-source.js';
import { createRemoteSource } from '../src/remote-factory.js';
import { parseSourceConfig, loadSourceConfig, sourceIdentity } from '../src/source-config.js';
import { callNoteShell } from '../src/note-shell.js';
import { gitlabFixture } from './fixtures/gitlab.js';
const site = 'https://gitlab.example.test/gitlab';
const source = {type:'gitlab' as const,url:site,repository:'group/subgroup/project',branch:'main'};
const reader = (f: ReturnType<typeof gitlabFixture>, token: string | undefined = 'fixture-token', branch='main') => new GitLabSource(site,source.repository,branch,token,f.request);

describe('GitLab source configuration',()=>{
  it('supports SaaS, self-managed subpaths and nested namespaces with stable source identity',()=>{
    expect(parseSourceConfig({source:{...source,url:site+'/'}},'/tmp')).toEqual(source);
    expect(parseSourceConfig({source:{...source,url:undefined}},'/tmp')).toMatchObject({url:'https://gitlab.com'});
    expect(sourceIdentity(source)).not.toBe(sourceIdentity({...source,url:'https://other.test'}));
    expect(loadSourceConfig('/tmp',{MYGITNOTES_SOURCE:'gitlab',MYGITNOTES_REPOSITORY:source.repository,MYGITNOTES_BRANCH:'main',GITLAB_URL:site})).toEqual(source);
    expect(loadSourceConfig('/tmp',{GITHUB_NOTES_SOURCE:'github',GITHUB_NOTES_REPOSITORY:'owner/repo',GITHUB_NOTES_BRANCH:'main'})).toEqual({type:'github',repository:'owner/repo',branch:'main'});
    for(const url of ['http://site.test','https://user:secret@site.test','https://site.test?token=x','https://site.test/#x','https://site.test/%2e%2e/escape']) expect(()=>parseSourceConfig({source:{...source,url}},'/tmp')).toThrow();
    for(const repository of ['../x','group/../x','group//project','https://site/a','group/project?x']) expect(()=>parseSourceConfig({source:{...source,repository}},'/tmp')).toThrow();
  });
});
describe('GitLab remote contract',()=>{
  it('reads notes, folders and assets at one revision through the factory and paginates the complete tree',async()=>{
    const f=gitlabFixture();for(let i=0;i<110;i++) f.files.set(`notes/ex/item-${i}.md`,`# Item ${i}`);
    const r=createRemoteSource(source,'fixture-token',f.request);
    const notes=await r.notes('ex'); expect(notes).toHaveLength(112);
    expect(notes.find(n=>n.title==='Alpha')?.metadata.custom).toBe('preserved');
    expect((await r.folders())[0].title).toBe('Folder');
    expect((await r.assets('ex'))[0].rawUrl).toMatch(/^\/raw-assets\/by-hash\//);
    expect(f.calls.filter(c=>c.url.includes('/repository/tree?'))).toHaveLength(2);
    expect(f.calls.filter(c=>c.url.includes('/repository/tree?')).every(c=>c.url.includes(`ref=${f.head}`))).toBe(true);
    expect(f.calls.every(c=>c.init?.redirect==='error')).toBe(true);
  });
  it('allows anonymous public reads and denies private reads and read-only or core writes',async()=>{
    const f=gitlabFixture();await expect(new GitLabSource(site,source.repository,'main',undefined,f.request).notes()).rejects.toMatchObject({status:404});
    f.public();expect((await new GitLabSource(site,source.repository,'main',undefined,f.request).notes()).length).toBe(2);
    f.readOnly();await expect(reader(f).save('notes/ex/a.md','# changed',{},f.head)).rejects.toMatchObject({status:403});
    await expect(reader(gitlabFixture(),'fixture-token','core').save('notes/ex/a.md','# changed',{},f.head)).rejects.toMatchObject({status:403});expect(f.writes).toBe(0);
  });
  it('commits selected notes atomically with per-file version guards and preserves unknown frontmatter',async()=>{
    const f=gitlabFixture(),r=reader(f);const notes=await r.notes();
    const result=await r.commitNotes(notes.map(n=>({...n,content:n.content+'\nUpdated'})),f.head,'docs: update notes');
    expect(result.commit.commitHash).toBe(f.head);expect(f.writes).toBe(1);expect(f.files.get('notes/ex/a.md')).toContain('custom: preserved');
    const body=JSON.parse(String(f.calls.find(c=>c.init?.method==='POST')!.init!.body));
    expect(body).toMatchObject({branch:'main',force:false,commit_message:'docs: update notes'});expect(body.actions).toHaveLength(2);
    expect(body.actions.every((a:any)=>a.last_commit_id==='b'.repeat(40)&&a.encoding==='base64')).toBe(true);
  });
  it('rejects stale and racing edits, symlinks and product writes without partial commits',async()=>{
    const f=gitlabFixture();f.files.set('notes/ex/symlink.md','secret');const r=reader(f);
    await expect(r.save('notes/ex/a.md','# changed',{},'stale')).rejects.toMatchObject({status:409});
    await expect(r.save('apps/escape.md','# changed',{},f.head)).rejects.toMatchObject({status:403});
    await expect(r.readFile('notes/ex/symlink.md')).rejects.toMatchObject({status:404});
    f.conflict();await expect(r.commitNotes([{path:'notes/ex/a.md',content:'overwrite',metadata:{}}],f.head,'change')).rejects.toMatchObject({status:409});
    expect(f.writes).toBe(0);expect(f.files.get('notes/ex/a.md')).toContain('# Alpha');
  });
  it('supports the same shell write, move and delete operations used by MCP',async()=>{
    const f=gitlabFixture();
    await callNoteShell(reader(f),'write',{path:'notes/ex/new.md',content:'# New',revision:f.head},true);expect(f.files.get('notes/ex/new.md')).toBe('# New');
    await callNoteShell(reader(f),'mv',{source:'notes/ex/new.md',destination:'notes/ex/moved.md',revision:f.head},true);
    expect(f.files.has('notes/ex/new.md')).toBe(false);expect(f.files.get('notes/ex/moved.md')).toBe('# New');
    await callNoteShell(reader(f),'rm',{paths:['notes/ex/moved.md'],revision:f.head},true);expect(f.files.has('notes/ex/moved.md')).toBe(false);expect(f.writes).toBe(3);
  });
  it('returns rate limiting without retrying a mutation and rejects a redirected endpoint',async()=>{
    const request=(async()=>new Response('{}',{status:429,headers:{'Retry-After':'12'}})) as typeof fetch;
    await expect(new GitLabSource(site,source.repository,'main','token',request).notes()).rejects.toMatchObject({status:429,retryAfter:12});
    const redirected=(async()=>{throw new TypeError('redirect');}) as typeof fetch;
    await expect(new GitLabSource(site,source.repository,'main','token',redirected).notes()).rejects.toMatchObject({status:502});
  });
});
