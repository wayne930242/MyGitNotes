import { describe, it, expect } from 'vitest';
import { GitHubSource } from '../src/github-source.js';
import { callNoteShell, replaceNoteLines, matchNoteGlob } from '../src/note-shell.js';

function fixture() {
  const raw:Record<string,string>={
    '.github-notes.yaml':'schema_version: 1\nworkspace:\n  title: Shell QA\n  default_notebook: ex\nnotebooks:\n  - id: ex\n    title: Example\n    root: notes/ex\n',
    'notes/ex/a.md':'---\ncustom: retained\n---\n# Alpha\nhello world\n',
    'notes/ex/work/_dir.yml':'title: Work\n',
    'notes/ex/work/b.md':'# Beta\nhello again\n',
    'notes/ex/assets/private.txt':'not a note',
  };
  const objects=new Map<string,string>();let files=new Map<string,string>();let counter=0;let head='head0';let treeId='tree0';
  for(const [file,text] of Object.entries(raw)){const id='blob'+counter++;objects.set(id,text);files.set(file,id);}
  const trees=new Map<string,Map<string,string>>([[treeId,new Map(files)]]);const commits=new Map<string,string>([[head,treeId]]);const calls:{endpoint:string;method?:string;body:any}[]=[];
  const request:typeof fetch=async(input,init)=>{
    const endpoint=String(input).replace('https://api.github.com/repos/owner/repo','');const body=init?.body?JSON.parse(String(init.body)):{};calls.push({endpoint,method:init?.method,body});let result:any;
    if(!endpoint)result={private:true,permissions:{push:true}};
    else if(endpoint.startsWith('/commits/')){const ref=endpoint.slice('/commits/'.length);const sha=ref==='main'?head:ref;result={sha,commit:{tree:{sha:commits.get(sha)}}};}
    else if(endpoint.startsWith('/git/trees/')&&!init?.method){
      const id=endpoint.slice('/git/trees/'.length).split('?')[0];const entries=[];const dirs=new Set<string>();for(const [file,sha] of trees.get(id)!){const parts=file.split('/');for(let i=1;i<parts.length;i++)dirs.add(parts.slice(0,i).join('/'));entries.push({path:file,sha,type:'blob',mode:'100644',size:objects.get(sha)!.length});}result={truncated:false,tree:[...entries,...[...dirs].map(path=>({path,sha:path,type:'tree',mode:'040000'}))]};
    }else if(endpoint.startsWith('/git/blobs/')&&!init?.method)result={encoding:'base64',content:Buffer.from(objects.get(endpoint.slice('/git/blobs/'.length))!).toString('base64')};
    else if(endpoint==='/git/blobs'){const sha='blob'+counter++;objects.set(sha,body.encoding === 'base64' ? Buffer.from(body.content, 'base64').toString('utf8') : body.content);result={sha};}
    else if(endpoint==='/git/trees'){const next=new Map(trees.get(body.base_tree));for(const change of body.tree)if(change.sha===null)next.delete(change.path);else next.set(change.path,change.sha);const sha='tree'+counter++;trees.set(sha,next);result={sha};}
    else if(endpoint==='/git/commits'){const sha='head'+counter++;commits.set(sha,body.tree);result={sha};}
    else if(endpoint.startsWith('/git/refs/heads/')){expect(body.force).toBe(false);head=body.sha;treeId=commits.get(head)!;files=new Map(trees.get(treeId));result={object:{sha:head}};}
    else return new Response('{}',{status:404});
    return new Response(JSON.stringify(result));
  };
  return {reader:()=>new GitHubSource('owner/repo','main','test-token',request),calls,head:()=>head,text:(file:string)=>objects.get(files.get(file)!),files:()=>[...files.keys()]};
}

describe('shell-shaped note operations',()=>{
  it('commits selected browser notes atomically and rejects invalid batches before writing', async () => {
    const f = fixture(); const baseline = f.head();
    const result = await f.reader().commitNotes([
      { path: 'notes/ex/a.md', content: '# Alpha changed\n', metadata: { custom: 'retained', status: 'working' } },
      { path: 'notes/ex/new.md', content: '# New\n', metadata: { status: 'inbox' }, createOnly: true },
    ], baseline, 'docs(notes): review two notes');
    expect(result.commit.message).toBe('docs(notes): review two notes');
    expect(f.text('notes/ex/a.md')).toContain('custom: retained');
    expect(f.text('notes/ex/new.md')).toContain('# New');
    expect(f.calls.filter(call => call.endpoint === '/git/commits')).toHaveLength(1);
    expect(f.calls.filter(call => call.method === 'PATCH')).toHaveLength(1);
    const writes = () => f.calls.filter(call => call.method).length;
    const before = writes();
    await expect(f.reader().commitNotes([{ path: 'notes/ex/a.md', content: 'stale', metadata: {} }], baseline, 'stale')).rejects.toMatchObject({ status: 409 });
    await expect(f.reader().commitNotes([{ path: 'notes/ex/a.md', content: 'collision', metadata: {}, createOnly: true }], f.head(), 'collision')).rejects.toMatchObject({ status: 409 });
    await expect(f.reader().commitNotes([{ path: 'notes/ex/missing.md', content: 'lost', metadata: {} }], f.head(), 'missing')).rejects.toMatchObject({ status: 409 });
    await expect(f.reader().commitNotes([{ path: 'notes/ex/a.md', content: 'valid', metadata: {} }, { path: 'notes/ex/../../.env', content: 'bad', metadata: {}, createOnly: true }], f.head(), 'bad')).rejects.toThrow();
    expect(writes()).toBe(before);
  });
  it('uploads, moves and deletes remote assets with stable references and one commit per operation', async () => {
    const f = fixture();
    const upload = await f.reader().mutateAsset('upload', {notebookId:'ex',filename:'new.txt',directory:'images',base64Content:Buffer.from('original bytes').toString('base64'),revision:f.head()});
    expect(f.text(upload.path)).toBe('original bytes');
    const asset = (await f.reader().assets('ex')).find(a => a.path === upload.path)!;
    const moved = await f.reader().mutateAsset('move', {path:upload.path,directory:'archive',revision:f.head()});
    expect(f.text(moved.path)).toBe('original bytes');
    expect((await f.reader().assets('ex')).find(a => a.path === moved.path)?.rawUrl).toBe(asset.rawUrl);
    await expect(f.reader().mutateAsset('delete', {path:moved.path,revision:'head0'})).rejects.toMatchObject({status:409});
    await expect(f.reader().mutateAsset('delete', {path:'notes/ex/a.md',revision:f.head()})).rejects.toMatchObject({status:403});
    await f.reader().mutateAsset('delete', {path:moved.path,revision:f.head()});
    expect(f.files()).not.toContain(moved.path);
    expect(f.calls.filter(c=>c.endpoint==='/git/commits')).toHaveLength(3);
    expect(f.calls.filter(c=>c.method==='PATCH')).toHaveLength(3);
  });
  it('lists, globs, reads raw line ranges and finds bounded literal matches',async()=>{
    const f=fixture();
    const ls=await callNoteShell(f.reader(),'ls',{},false);expect(ls.entries).toEqual([{path:'notes/ex',type:'directory'}]);
    const glob=await callNoteShell(f.reader(),'glob',{pattern:'notes/ex/**/*.{md,txt}',limit:1},false);expect(glob.paths).toEqual(['notes/ex/a.md']);expect(glob.total).toBe(2);expect(glob.nextOffset).toBe(1);
    const read=await callNoteShell(f.reader(),'read',{path:'notes/ex/a.md',startLine:2,maxLines:3},false);expect(read.content).toBe('custom: retained\n---\n# Alpha\n');expect(read.nextLine).toBe(5);
    const found=await callNoteShell(f.reader(),'find',{query:'HELLO',pattern:'**/*.md'},false);expect(found.matches).toEqual([{path:'notes/ex/a.md',line:5,text:'hello world'},{path:'notes/ex/work/b.md',line:2,text:'hello again'}]);
    expect(f.calls.some(c=>c.method)).toBe(false);
  });
  it('edits exact raw lines, preserves frontmatter and returns a generated remote commit receipt',async()=>{
    const f=fixture();const result:any=await callNoteShell(f.reader(),'edit',{path:'notes/ex/a.md',startLine:5,endLine:5,content:'changed',revision:f.head()},true);
    expect(f.text('notes/ex/a.md')).toBe('---\ncustom: retained\n---\n# Alpha\nchanged\n');
    expect(result.pushed).toBe(true);expect(result.commit.message).toBe('docs(notes): edit a.md');expect(result.revision).toBe(f.head());
    expect(f.calls.filter(c=>c.endpoint==='/git/commits')).toHaveLength(1);
    expect(f.calls.filter(c=>c.method==='PATCH')).toHaveLength(1);
    await expect(callNoteShell(f.reader(),'write',{path:'notes/ex/a.md',content:'stale',revision:'head0'},true)).rejects.toMatchObject({status:409});
    expect(f.calls.filter(c=>c.endpoint==='/git/commits')).toHaveLength(1);
  });
  it('copies, moves, removes directories atomically and creates persistent folder metadata',async()=>{
    const f=fixture();
    await callNoteShell(f.reader(),'cp',{source:'notes/ex/work',destination:'notes/ex/copied',recursive:true,revision:f.head()},true);
    expect(f.text('notes/ex/copied/b.md')).toBe(f.text('notes/ex/work/b.md'));
    await callNoteShell(f.reader(),'mv',{source:'notes/ex/copied',destination:'notes/ex/moved',recursive:true,revision:f.head()},true);
    expect(f.files()).not.toContain('notes/ex/copied/b.md');expect(f.files()).toContain('notes/ex/moved/_dir.yml');
    await callNoteShell(f.reader(),'rm',{paths:['notes/ex/moved'],recursive:true,revision:f.head()},true);expect(f.files().some(p=>p.startsWith('notes/ex/moved/'))).toBe(false);
    await callNoteShell(f.reader(),'mkdir',{path:'notes/ex/new/deep',title:'Deep',order:3,description:'Deep notes',revision:f.head()},true);
    expect(f.text('notes/ex/new/deep/_dir.yml')).toContain('title: Deep');
    expect(f.text('notes/ex/new/deep/_dir.yml')).toContain('order: 3');
    expect(f.text('notes/ex/new/deep/_dir.yml')).toContain('description: Deep notes');
    await callNoteShell(f.reader(),'update_folder_metadata',{path:'notes/ex/new/deep',order:5,description:'Updated deep notes',revision:f.head()},true);
    expect(f.text('notes/ex/new/deep/_dir.yml')).toContain('title: Deep');
    expect(f.text('notes/ex/new/deep/_dir.yml')).toContain('order: 5');
    expect(f.text('notes/ex/new/deep/_dir.yml')).toContain('description: Updated deep notes');
    expect(f.calls.filter(c=>c.endpoint==='/git/commits')).toHaveLength(5);expect(f.calls.filter(c=>c.method==='PATCH')).toHaveLength(5);
    const move=f.calls.filter(c=>c.endpoint==='/git/trees'&&c.method)[1];expect(move.body.tree).toHaveLength(4);expect(move.body.tree.filter((c:any)=>c.sha===null)).toHaveLength(2);
  });
  it('appends and creates notes with one commit each',async()=>{
    const f=fixture();await callNoteShell(f.reader(),'write',{path:'notes/ex/new.md',content:'# New\n',createOnly:true,revision:f.head()},true);
    await callNoteShell(f.reader(),'append',{path:'notes/ex/new.md',content:'next\n',revision:f.head()},true);expect(f.text('notes/ex/new.md')).toBe('# New\nnext\n');
    await expect(callNoteShell(f.reader(),'write',{path:'notes/ex/new.md',content:'bad',createOnly:true,revision:f.head()},true)).rejects.toMatchObject({status:409});
    expect(f.calls.filter(c=>c.endpoint==='/git/commits')).toHaveLength(2);
  });
  it('rejects readonly writes, traversal, protected roots, recursive ambiguity and destination collisions',async()=>{
    const f=fixture();
    await expect(callNoteShell(f.reader(),'rm',{paths:['notes/ex/a.md'],revision:f.head()},false)).rejects.toMatchObject({status:403});
    await expect(callNoteShell(f.reader(),'read',{path:'../.env'},false)).rejects.toThrow(/relative/);
    await expect(callNoteShell(f.reader(),'rm',{paths:['notes/ex'],recursive:true,revision:f.head()},true)).rejects.toMatchObject({status:403});
    await expect(callNoteShell(f.reader(),'mv',{source:'notes/ex/work',destination:'notes/ex/other',revision:f.head()},true)).rejects.toThrow(/recursive/);
    await expect(callNoteShell(f.reader(),'cp',{source:'notes/ex/a.md',destination:'notes/ex/work/b.md',revision:f.head()},true)).rejects.toMatchObject({status:409});
    expect(f.calls.some(c=>c.method)).toBe(false);
  });
  it('supports insertion and deletion with preserved CRLF and rejects invalid line ranges',()=>{
    expect(replaceNoteLines('a\r\nb\r\n',2,1,'new')).toBe('a\r\nnew\r\nb\r\n');
    expect(replaceNoteLines('a\nb\nc',2,2,'')).toBe('a\nc');
    expect(()=>replaceNoteLines('a',3,3,'x')).toThrow(/line range/);
    expect(()=>matchNoteGlob('../*')).toThrow(/relative glob/);
  });
});
