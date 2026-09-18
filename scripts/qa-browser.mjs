import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { resolveQaChromePath } from './qa-chrome.mjs';
const product=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require=createRequire(`${product}/apps/web/package.json`);
const puppeteer=require('puppeteer-core');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'github-notes-browser-'));
const write=(p,s)=>{fs.mkdirSync(path.dirname(path.join(root,p)),{recursive:true});fs.writeFileSync(path.join(root,p),s);};
const git=(...args)=>execFileSync('git',args,{cwd:root,stdio:'pipe'});
write('notes/.github-notes.yaml','schema_version: 1\nworkspace:\n  title: Folder QA\n  default_notebook: example\nnotebooks:\n  - id: example\n    title: Example\n    root: notes/example\n');
write('notes/example/root.md','# Root Note\n');
write('notes/example/projects/_dir.yml','title: Projects\norder: -1\n');
write('notes/example/projects/deep/_dir.yml','title: Deep work\n');
write('notes/example/projects/deep/nested.md','# Nested Note\n');
write('notes/example/assets/pixel.png',Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'));
git('init','-b','main');git('config','user.name','Browser QA');git('config','user.email','qa@example.com');git('add','.');git('commit','-m','fixture');
process.env.MYGITNOTES_SOURCE='local';process.env.MYGITNOTES_LOCAL_PATH=root;delete process.env.VERCEL;delete process.env.APP_URL;
const {createApp}=await import(`${product}/apps/local-server/dist/app.js`);
const server=createServer(createApp(product));await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await puppeteer.launch({executablePath:resolveQaChromePath(),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const page=await browser.newPage();await page.setViewport({width:1440,height:1000});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const click=async text=>{await page.waitForFunction(text=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()===text&&!b.disabled),{},text);await page.evaluate(text=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===text&&!b.disabled).click(),text);};
try {
 await page.goto(base,{waitUntil:'networkidle0'});
 await page.waitForFunction(()=>document.body.innerText.includes('Deep work'));
 await click('Deep work');
 await page.waitForFunction(()=>document.body.innerText.includes('Nested Note')&&!document.body.innerText.includes('Root Note'));
 console.log('PASS nested folder filtering');
 await click('New Note');
 await page.waitForSelector('input[aria-describedby="create-note-error"]');
 await page.type('input[aria-describedby="create-note-error"]','Created Nested');
 await page.type('input[aria-label="Folder path"]','projects/deep');
 await click('Create Note');
 await page.waitForFunction(()=>document.body.innerText.includes('created-nested.md'));
 await page.waitForSelector('[data-live-markdown] .cm-content');
 await click('Source');
 if(!fs.existsSync(path.join(root,'notes/example/projects/deep/created-nested.md')))throw Error('Created note missing from selected folder');
 console.log('PASS nested note creation');
 await page.waitForSelector('button[aria-label="Document tools"]');
 await page.click('button[aria-label="Document tools"]');
 await page.click('.note-panel-tabs [role="tab"][aria-label="Notebook Assets"]');
 await page.waitForFunction(()=>document.body.innerText.includes('pixel.png'));
 // Upload selects an asset without changing the note; Insert is explicit.
 const uploadFile = path.join(root, 'upload.png');fs.copyFileSync(path.join(root,'notes/example/assets/pixel.png'),uploadFile);
 await page.type('input[aria-label="Asset folder"]','incoming');
 const uploadControl = await page.$('input[aria-label="Upload asset"]');await uploadControl.uploadFile(uploadFile);
 await page.waitForSelector('button[aria-label="Select upload.png"][aria-pressed="true"]');
 if(await page.$eval('textarea[aria-label="Note content"]',e=>e.value.includes('/raw-assets/')))throw Error('Upload inserted without explicit Insert');
 await click('View');await page.waitForSelector('[aria-label="Asset preview"]');await page.keyboard.press('Escape');
 await page.waitForFunction(()=>!document.querySelector('[aria-label="Asset preview"]'));
 if(!await page.$('.note-document-panel[data-panel="assets"]'))throw Error('Preview Escape closed asset panel');
 await click('Insert');
 await page.waitForFunction(()=>Array.from(document.querySelectorAll('textarea')).some(t=>t.value.includes('/raw-assets/by-hash/')));
 await click('Live Preview');
 await page.waitForFunction(()=>Array.from(document.querySelectorAll('img')).some(i=>i.src.includes('/raw-assets/by-hash/')&&i.complete&&i.naturalWidth>0));
 console.log('PASS hash asset insertion and rendered image');
 fs.mkdirSync(`${product}/artifacts/qa`,{recursive:true});
 await page.screenshot({path:`${product}/artifacts/qa/nested-editor.png`,fullPage:true});
 await page.click('button[aria-label="Close note"]');
 await click('New Note');
 await page.waitForSelector('input[aria-describedby="create-note-error"]');
 await page.type('input[aria-describedby="create-note-error"]','Created Nested');
 await page.type('input[aria-label="Folder path"]','projects/deep');
 await click('Create Note');
 await page.waitForFunction(()=>document.querySelector('#create-note-error')?.closest('.fixed')&&document.querySelector('#create-note-error').textContent.includes('already exists'));
 console.log('PASS duplicate creation error is visible inside the modal');

 await page.goto(base+'/assets',{waitUntil:'networkidle0'});
 await page.type('input[aria-label="Asset folder"]','incoming');
 await page.click('button[aria-label="Select upload.png"]');
 const originalUrl=await page.$eval('button[aria-label="Select upload.png"] img',e=>e.getAttribute('src'));
 await page.waitForFunction(()=>{const input=document.querySelector('input[aria-label="Move asset to folder"]');return input&&!input.disabled&&input.value==='incoming';});
 await page.focus('input[aria-label="Move asset to folder"]');await page.keyboard.down('Control');await page.keyboard.press('KeyA');await page.keyboard.up('Control');await page.type('input[aria-label="Move asset to folder"]','archive');
 await click('Move');await page.waitForFunction(()=>document.querySelector('input[aria-label="Asset folder"]').value==='archive');
 if(await page.$eval('button[aria-label="Select upload.png"] img',e=>e.getAttribute('src'))!==originalUrl)throw Error('Move changed hash URL');
 if(!(await fetch(base+originalUrl)).ok)throw Error('Hash URL stopped resolving after move');
 await click('Delete');await page.waitForFunction(()=>document.body.innerText.includes('Confirm delete'));
 if(!fs.existsSync(path.join(root,'notes/example/assets/archive/upload.png')))throw Error('First delete removed file');
 await click('Confirm delete');await page.waitForFunction(()=>!document.querySelector('button[aria-label="Select upload.png"]'));
 if(fs.existsSync(path.join(root,'notes/example/assets/archive/upload.png')))throw Error('Confirmed delete failed');
 console.log('PASS shared asset UI: dialog upload/select/view/insert, directory move, stable hash and reclick delete');

 let signedIn=false; let failSave=false; let savedPayload; let grants=[];
 const demoToken='x'.repeat(43);
 let remoteNotes=[{id:'public',path:'notes/example/public.md',notebookId:'example',title:'Public Note',content:'# Public Note\n\n<img src=x onerror="window.__xss=true">',metadata:{custom:'keep'},tags:[],revision:'one',status:'todo'}];
 await page.setRequestInterception(true);
 page.on('request',req=>{
  const u=new URL(req.url());let body;let status=200;
  if(u.pathname==='/api/workspace')body={config:{schema_version:1,workspace:{title:'Public GitHub QA',default_notebook:'example'},notebooks:[{id:'example',title:'Example',root:'notes/example'}]},branch:'main',repoRoot:'',gitStatus:{branch:'main',isClean:true,staged:[],modified:[],untracked:[]},source:{type:'github',identity:'github:owner/repo@main'},capabilities:{write:signedIn,local:false},revision:remoteNotes[0].revision};
  if(u.pathname==='/api/notes') {
   if(req.method()==='POST') {
    savedPayload=JSON.parse(req.postData());
    if(failSave){status=409;body={error:'Remote repository changed. Reload the note and retry.'};}
    else {remoteNotes=[{...remoteNotes[0],...savedPayload,revision:'two'}];body={note:remoteNotes[0],commit:{commitHash:'two'}};}
   }else body={notes:remoteNotes};
  }
  if(u.pathname==='/api/notes/read')body={note:remoteNotes[0]};
  if(u.pathname==='/api/folders')body={folders:[]};
  if(u.pathname==='/api/assets')body={assets:[]};
  if(u.pathname==='/api/agent-resources')body={instructions:[],skills:[],docs:[]};
  if(u.pathname==='/api/git/status')body={status:{branch:'main',isClean:true,staged:[],modified:[],untracked:[]},commits:[]};
  if(u.pathname==='/api/auth/session')body={authenticated:signedIn,login:signedIn?'test-owner':undefined,configured:true};
  if(u.pathname==='/api/auth/agent-tokens')body={grants};
  if(u.pathname==='/api/auth/agent-token'){
   const requested=JSON.parse(req.postData());grants=[{id:'grant-id',name:requested.name,write:requested.write,createdAt:Date.now(),source:'github:owner/repo@main',expiresAt:null}];body={token:demoToken,url:base+'/mcp/'+demoToken,endpoint:base+'/mcp',expiresIn:null};
  }
  if(u.pathname==='/api/auth/agent-tokens/grant-id'&&req.method()==='DELETE'){grants=[];body={success:true};}
  if(body)req.respond({status,contentType:'application/json',body:JSON.stringify(body)});else req.continue();
 });
 await page.goto(base+'/notes',{waitUntil:'networkidle0'});
 await page.waitForSelector('table');
 if(!await page.$('button[title="Card View"]')||!await page.$('button[title="Kanban View"]'))throw Error('Original view controls missing');
 if(await page.$eval('tbody button[role="combobox"]',e=>!e.disabled))throw Error('Public status control editable');
 if(await page.evaluate(()=>Array.from(document.querySelectorAll('button')).some(b=>['New Note','Create Note'].includes(b.textContent.trim())&&!b.disabled)))throw Error('Public new note action enabled');
 await page.click('tbody tr');await page.waitForSelector('[data-live-markdown]');
 if(await page.evaluate(()=>window.__xss))throw Error('Unsafe Markdown');
 await click('Source');if(!await page.$eval('textarea[aria-label="Note content"]',e=>e.readOnly))throw Error('Public editor not readonly');
 await page.click('button[aria-label="Document tools"]');
 await page.click('.note-panel-tabs [role="tab"][aria-label="Notebook Assets"]');
 await page.waitForSelector('.note-document-panel[data-panel="assets"]');
 await page.keyboard.press('Escape');
 if(!await page.$('button[aria-label="Close note"]'))throw Error('Asset Escape closed entire note');
 await page.keyboard.press('Escape');
 await page.waitForFunction(()=>!document.querySelector('button[aria-label="Close note"]'));
 console.log('PASS readonly asset browser and layered Escape shortcuts');
 await page.click('button[aria-label="Settings"]');await page.waitForSelector('#settings-manifest textarea');
 if(!await page.$eval('#settings-manifest textarea',e=>e.readOnly))throw Error('Remote manifest editable');
 await page.evaluate(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('GitHub Dark'))?.click());
 await page.waitForFunction(()=>document.documentElement.classList.contains('dark'));
 await page.screenshot({path:`${product}/artifacts/qa/restored-settings-dark.png`,fullPage:true});
 await page.reload({waitUntil:'networkidle0'});
 if(!await page.evaluate(()=>document.documentElement.classList.contains('dark')))throw Error('Theme lost on reload');
 await click('Notes');await page.waitForSelector('table');
 await page.screenshot({path:`${product}/artifacts/qa/restored-list-dark.png`,fullPage:true});
 await page.click('button[title="Card View"]');await page.waitForSelector('main h3');
 await page.screenshot({path:`${product}/artifacts/qa/restored-cards-dark.png`,fullPage:true});
 await page.click('button[title="Kanban View"]');await page.waitForSelector('[data-notepath]');
 if(await page.$eval('[data-notepath]',e=>e.draggable))throw Error('Public Kanban draggable');
 console.log('PASS restored navigation, table/cards/Kanban, Settings palettes, theme persistence and readonly controls');
 signedIn=true;await page.goto(base+'/settings',{waitUntil:'networkidle0'});
 // Remote working changes, conflict handling and commits are covered by qa-working-notes.
 await page.waitForSelector('input[aria-label="MCP client name"]');await page.type('input[aria-label="MCP client name"]','ChatGPT UAT');await click('Create grant');
 await page.waitForSelector('input[aria-label="MCP connection URL"]');
 if(await page.$eval('input[aria-label="MCP connection URL"]',e=>e.value)!==base+'/mcp/'+demoToken)throw Error('Connector URL missing token');
 await click('Dismiss');await page.screenshot({path:`${product}/artifacts/qa/restored-access-control.png`,fullPage:true});
 await click('Revoke');await click('Confirm revoke');await page.waitForFunction(()=>document.body.innerText.includes('No persistent agent grants yet'));
 console.log('PASS connector URL and manual revoke UI');
 if(errors.length)throw Error(`Browser errors: ${errors.join('; ')}`);
 console.log('PASS no browser runtime errors');
} catch(error) {console.log('UI failure state',await page.evaluate(()=>({alerts:Array.from(document.querySelectorAll('[role="alert"]')).map(e=>e.textContent),buttons:Array.from(document.querySelectorAll('button')).map(e=>({text:e.textContent,disabled:e.disabled})),url:location.pathname,inputs:Array.from(document.querySelectorAll('input')).map(e=>({label:e.getAttribute('aria-label'),value:e.getAttribute('aria-label')?.includes('URL')?'redacted':e.type==='file'?'file':e.value})),text:document.body.innerText.slice(-2500)})));throw error;} finally { await browser.close();await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true}); }
