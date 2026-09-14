import { chooseSelect } from './browser-select.mjs';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
const product=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require=createRequire(`${product}/apps/web/package.json`);
const puppeteer=require('puppeteer-core');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'github-notes-browser-'));
const write=(p,s)=>{fs.mkdirSync(path.dirname(path.join(root,p)),{recursive:true});fs.writeFileSync(path.join(root,p),s);};
const git=(...args)=>execFileSync('git',args,{cwd:root,stdio:'pipe'});
write('notes/.github-notes.yaml','schema_version: 1\nworkspace:\n  title: Folder QA\n  default_notebook: example\nnotebooks:\n  - id: example\n    title: Example\n    root: notes/example\n');
write('notes/example/root.md','---\nstatus: doing\ncustom: keep\n---\n# Root Note\n');
write('notes/example/projects/_dir.yml','title: Projects\norder: -1\n');
write('notes/example/projects/deep/_dir.yml','title: Deep work\n');
write('notes/example/projects/deep/nested.md','# Nested Note\n');
write('notes/example/assets/pixel.png',Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'));
write('notes/AGENTS.md','# Workspace Guidelines\n\nUse **Markdown** notes.\n');
write('notes/example/AGENTS.md','# Notebook Guidelines\n\nPreserve frontmatter.\n');
write('notes/research/review.md','---\nstatus: review\ncustom: preserve\n---\n# Research Note\n');
write('notes/research/other.md','---\nstatus: Review\n---\n# Case Note\n');
write('notes/example/archived.md','---\nstatus: archived\n---\n# Archived Note\n');
write('notes/example/hidden.md','---\nstatus: working\nhiden: true\n---\n# Hidden Note\n');
write('notes/example/visible-archive.md','---\nstatus: archived\nhiden: false\n---\n# Visible Archive\n');
git('init','-b','main');git('config','user.name','Browser QA');git('config','user.email','qa@example.com');git('add','.');git('commit','-m','fixture');
process.env.MYGITNOTES_SOURCE='local';process.env.MYGITNOTES_LOCAL_PATH=root;delete process.env.VERCEL;delete process.env.APP_URL;
const {createApp}=await import(`${product}/apps/local-server/dist/app.js`);
const server=createServer(createApp(product));await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await puppeteer.launch({executablePath:process.env.PUPPETEER_EXECUTABLE_PATH || path.join(os.homedir(),'.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome'),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const page=await browser.newPage();await page.setViewport({width:1440,height:1000});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const click=async text=>{await page.waitForFunction(text=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()===text&&!b.disabled),{},text);await page.evaluate(text=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===text&&!b.disabled).click(),text);};
const assert=(condition,message)=>{if(!condition)throw Error(message);};
const selector=title=>`button[role="combobox"][aria-label="Status for ${title}"]`;
const options=async selector=>{
 const trigger=await page.waitForSelector(selector,{visible:true});await trigger.scrollIntoView();
 if(page.viewport()?.hasTouch){
  const rect=await trigger.boundingBox();
  const hit=await page.evaluate(({x,y,width,height})=>document.elementFromPoint(x+width/2,y+height/2)?.closest('button')?.getAttribute('aria-label'),rect);
  assert(hit===await trigger.evaluate(e=>e.getAttribute('aria-label')),`Status tap target obstructed: ${hit}`);
  await page.touchscreen.tap(rect.x+rect.width/2,rect.y+rect.height/2);
 }else await trigger.click();
 await page.waitForSelector('[role="listbox"]');
 const result=await page.$$eval('[role="option"]',items=>items.map(item=>item.getAttribute('data-option-value')));
 await page.keyboard.press('Escape');return result;
};
const columns=()=>page.$$eval('[data-status-column]',items=>items.map(item=>item.getAttribute('data-status-column')));
const equal=(actual,expected,message)=>assert(JSON.stringify(actual)===JSON.stringify(expected),`${message}: ${JSON.stringify(actual)}`);
const waitDisk=async(file,text)=>{for(let i=0;i<100;i++){if(fs.existsSync(path.join(root,file))&&fs.readFileSync(path.join(root,file),'utf8').includes(text))return;await new Promise(r=>setTimeout(r,50));}throw Error(`Missing saved text: ${text}`);};
const manifest='schema_version: 1\nworkspace:\n  title: Status QA\n  default_notebook: example\nnotebooks:\n  - id: example\n    title: Example\n    root: notes/example\n  - id: research\n    title: Research\n    root: notes/research\n    statuses: [capture, published]\n';
const replace=async(selector,text)=>{await page.focus(selector);await page.keyboard.down('Control');await page.keyboard.press('KeyA');await page.keyboard.up('Control');await page.keyboard.type(text);};
let rev=1, commits=[], failCommit=false, reads=[];
const makeNote=(name)=>({id:name,path:`notes/example/${name}.md`,notebookId:'example',title:name,content:`# ${name}\n\nFirst line\n\nLast line\n`,metadata:{status:'inbox',custom:'keep'},status:'inbox',tags:[],revision:String(rev)});
let remoteNotes=[makeNote('welcome'),makeNote('second')];
const bump=()=>{rev++;remoteNotes=remoteNotes.map(note=>({...note,revision:String(rev)}));};
await page.setRequestInterception(true);
page.on('request',request=>{
 const url=new URL(request.url());let body,status=200;
 if(url.pathname==='/api/workspace')body={config:{schema_version:1,workspace:{title:'Working notes QA',default_notebook:'example'},notebooks:[{id:'example',title:'Example',root:'notes/example'}]},branch:'main',repoRoot:'',gitStatus:{branch:'main',isClean:true,staged:[],modified:[],untracked:[]},source:{type:'github',identity:'github:working/fixture@main'},capabilities:{write:true,local:false},revision:String(rev)};
 if(url.pathname==='/api/notes'){
  assert(request.method()==='GET','Edit used immediate remote save');body={notes:remoteNotes};
 }
 if(url.pathname==='/api/notes/read'){
  const file=url.searchParams.get('path');reads.push(file);const note=remoteNotes.find(n=>n.path===file);
  body=note?{note}:{error:'Missing'};status=note?200:404;
 }
 if(url.pathname==='/api/notes/read-batch'){
  const payload=JSON.parse(request.postData());reads.push(...payload.paths);
  body={notes:payload.paths.map(file=>remoteNotes.find(n=>n.path===file)).filter(Boolean)};
 }
 if(url.pathname==='/api/notes/commit'){
  const payload=JSON.parse(request.postData());
  if(failCommit||payload.revision!==String(rev)){status=409;body={error:'Remote revision changed. Retry Commit.'};}
  else {commits.push(payload);for(const note of payload.notes){const previous=remoteNotes.find(n=>n.path===note.path)||makeNote(note.path.split('/').pop().slice(0,-3));remoteNotes=remoteNotes.filter(n=>n.path!==note.path);remoteNotes.push({...previous,...note,status:note.metadata.status});}bump();body={revision:String(rev),commit:{commitHash:String(rev)}};}
 }
 if(url.pathname==='/api/auth/session')body={authenticated:true,login:'fixture',configured:true};
 if(url.pathname==='/api/folders')body={folders:[]};
 if(url.pathname==='/api/assets')body={assets:[]};
 if(url.pathname==='/api/git/status')body={status:{branch:'main',isClean:true,staged:[],modified:[],untracked:[]},commits:[]};
 if(body)void request.respond({status,contentType:'application/json',body:JSON.stringify(body)});else void request.continue();
});
const pending=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('gh_notes_working:github:working/fixture@main:main')||'{}'));
const open=async(name)=>{await page.goto(base+`/notebooks/example/notes/${name}.md`,{waitUntil:'networkidle0'});await page.waitForSelector('[aria-label="Close note"]');await click('Source');};
const edit=async(text)=>{await replace('textarea[aria-label="Note content"]',text);await page.waitForFunction(()=>document.body.innerText.includes('Saved locally'));};
const close=()=>page.click('[aria-label="Close note"]');
const commit=async()=>{await click('Commit');await click('Commit to GitHub');await page.waitForFunction(()=>!document.querySelector('[aria-label="Commit Changes"]'));};
try {
 await open('welcome');
 assert(reads.includes('notes/example/welcome.md'),'Read lost configured path');
 await edit('# welcome\n\nLocal first\n\nLast line\n');await close();
 assert(commits.length===0,'Editing committed');
 await open('welcome');
 assert((await page.$eval('textarea[aria-label="Note content"]',e=>e.value)).includes('Local first'),'Reload lost local save');await close();
 await open('second');await edit('# second\n\nOther local\n\nLast line\n');await close();
 await click('Commit');await page.click('[aria-label="Commit notes/example/second.md"]');await click('Commit to GitHub');await page.waitForFunction(()=>!document.querySelector('[aria-label="Commit Changes"]'));
 assert(commits.length===1&&commits[0].notes.length===1,'Selection did not isolate one commit');
 assert(Object.keys(await pending()).join()==='notes/example/second.md','Unselected draft lost');
 failCommit=true;await click('Commit');await click('Commit to GitHub');await page.waitForSelector('[role="alert"]');
 assert(Object.keys(await pending()).length===1,'Failed commit cleared drafts');
 failCommit=false;await click('Commit to GitHub');await page.waitForFunction(()=>!document.querySelector('[aria-label="Commit Changes"]'));
 assert(commits.length===2&&Object.keys(await pending()).length===0,'Retry did not clear committed drafts');
 console.log('PASS exact read path, local save/reload, explicit partial commit and failed commit retention');

 await open('welcome');await edit('# welcome\n\nLocal second\n\nLast line\n');await close();
 remoteNotes=remoteNotes.map(n=>n.path.endsWith('/welcome.md')?{...n,content:n.content.replace('Last line','Remote last')}:n);bump();
 await click('Commit');await click('Commit to GitHub');await page.waitForFunction(()=>document.body.innerText.includes('Review the updated diff'));
 assert(commits.length===2,'Merge review committed immediately');
 const merged=(await pending())['notes/example/welcome.md'];assert(merged.note.content.includes('Local second')&&merged.note.content.includes('Remote last'),'Nonoverlap merge dropped text');
 await click('Commit to GitHub');await page.waitForFunction(()=>!document.querySelector('[aria-label="Commit Changes"]'));
 await open('welcome');await edit('# welcome\n\nConflict local\n\nRemote last\n');await close();
 remoteNotes=remoteNotes.map(n=>n.path.endsWith('/welcome.md')?{...n,content:n.content.replace('Local second','Conflict remote')}:n);bump();
 await click('Commit');await click('Commit to GitHub');await page.waitForFunction(()=>document.body.innerText.includes('Remote changes conflict'));
 assert(commits.length===3&&(await pending())['notes/example/welcome.md'].blocked,'Conflict failed to block commit');
 await page.click('[aria-label="Close commit"]');await open('welcome');
 assert(await page.$eval('textarea[aria-label="Note content"]',e=>e.readOnly),'Conflict editor remained writable');
 await click('Refresh remote version');await page.waitForFunction(()=>!document.querySelector('textarea[aria-label="Note content"]').readOnly);
 assert((await page.$eval('textarea[aria-label="Note content"]',e=>e.value)).includes('Conflict remote'),'Refresh did not restore remote');
 assert(await page.evaluate(()=>Object.keys(localStorage).some(key=>key.includes(':conflict:')&&localStorage.getItem(key).includes('Conflict local'))),'Refresh lost conflict backup');await close();
 console.log('PASS nonoverlap merge review, conflict commit lock and explicit refresh');

 await click('New Note');await page.type('input[aria-describedby="create-note-error"]','New local');await click('Create Note');await page.waitForSelector('[aria-label="Close note"]');await click('Source');
 await edit('# New local\n\nCreated offline draft\n');await close();
 assert(commits.length===3&&!reads.includes('notes/example/new-local.md'),'New local note required remote persistence');
 await page.setViewport({width:320,height:700,isMobile:true,hasTouch:true});
 await page.goto(base+'/notebooks/example',{waitUntil:'networkidle0'});await click('Commit');
 const rect=await page.$eval('[aria-label="Commit Changes"]',e=>{const r=e.getBoundingClientRect();return {x:r.x,right:r.right,bottom:r.bottom};});
 assert(rect.x>=0&&rect.right<=320&&rect.bottom<=700,'Mobile commit dialog overflow');
 await click('Commit to GitHub');await page.waitForFunction(()=>!document.querySelector('[aria-label="Commit Changes"]'));
 assert(commits.length===4&&commits[3].notes[0].createOnly,'New note did not commit explicitly');
 console.log('PASS new-note local draft and mobile explicit Commit');
 await page.setViewport({width:1440,height:1000});await open('welcome');
 await page.evaluate(()=>{window.originalStorageSet=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.startsWith('gh_notes_working:'))throw Error('Storage full');return window.originalStorageSet.call(this,key,value);};});
 await replace('textarea[aria-label="Note content"]','# Quota draft');
 await page.waitForFunction(()=>document.body.innerText.includes('Local save failed: Storage full'));await close();
 assert(await page.$('[aria-label="Close note"]'),'Failed local save silently closed editor');
 await page.evaluate(()=>{Storage.prototype.setItem=window.originalStorageSet;});await close();
 assert((await pending())['notes/example/welcome.md'].note.content==='# Quota draft','Retry lost unsaved content');
 console.log('PASS storage failure remains visible and close retries local save');
 assert(!errors.length,errors.join('; '));
} catch(error) {console.log(await page.evaluate(()=>({url:location.href,text:document.body.innerText.slice(-3000)})));throw error;}
finally {await browser.close();await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true});}
