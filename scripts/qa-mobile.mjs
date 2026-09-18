import { chooseSelect } from './browser-select.mjs';
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
write('notes/.github-notes.yaml','schema_version: 1\nworkspace:\n  title: Folder QA\n  default_notebook: example\nnotebooks:\n  - id: example\n    title: Example workspace with a very long notebook title that must fit inside a mobile select popup\n    root: notes/example\n');
write('notes/example/root.md','# Root Note\n');
write('notes/example/projects/_dir.yml','title: Projects\norder: -1\n');
write('notes/example/projects/deep/_dir.yml','title: Deep work\n');
write('notes/example/projects/deep/nested.md','# Nested Note\n');
write('notes/example/assets/pixel.png',Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'));
write('notes/AGENTS.md','# Workspace Guidelines\n\nUse **Markdown** notes.\n');
write('notes/example/AGENTS.md','# Notebook Guidelines\n\nPreserve frontmatter.\n');
git('init','-b','main');git('config','user.name','Browser QA');git('config','user.email','qa@example.com');git('add','.');git('commit','-m','fixture');
process.env.MYGITNOTES_SOURCE='local';process.env.MYGITNOTES_LOCAL_PATH=root;delete process.env.VERCEL;delete process.env.APP_URL;
const {createApp}=await import(`${product}/apps/local-server/dist/app.js`);
const server=createServer(createApp(product));await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await puppeteer.launch({executablePath:resolveQaChromePath(),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
fs.mkdirSync(product+'/artifacts/qa',{recursive:true});
const page=await browser.newPage();await page.setViewport({width:1440,height:1000});
const errors=[];page.on('pageerror',e=>errors.push(e.message));

const assert = (condition, message) => { if (!condition) throw Error(message); };
const bounds = async selector => page.$eval(selector, element => {
 const r=element.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};
});
const fits = async (selector, minWidth=0) => {
 const r=await bounds(selector);const viewport=await page.evaluate(()=>({width:innerWidth,height:visualViewport?.height||innerHeight}));
 assert(r.x>=-1&&r.right<=viewport.width+1&&r.y>=-1&&r.bottom<=viewport.height+1&&r.width>=minWidth, `${selector} outside viewport: ${JSON.stringify(r)}`);
};
const tap = async selector => {
 await page.waitForSelector(selector,{visible:true});await page.$eval(selector,e=>e.scrollIntoView());
 const r=await bounds(selector);await page.touchscreen.tap(r.x+r.width/2,r.y+r.height/2);
};
const click = async text => {
 if(['Source','Live Preview'].includes(text)) {
  const mobile=await page.$('button[role="combobox"][aria-label="Editor mode"]');
  if(mobile&&await mobile.evaluate(e=>e.getBoundingClientRect().width>0)) {await chooseSelect(page, 'button[role="combobox"][aria-label="Editor mode"]',text==='Source'?'raw':'live');return;}
 }
 const buttons=await page.$$('button');
 for(const button of buttons) {
  if(await button.evaluate((e,text)=>e.textContent.trim()===text&&e.getBoundingClientRect().width>0,text)) {
   await button.scrollIntoView();const r=await button.boundingBox();await page.touchscreen.tap(r.x+r.width/2,r.y+r.height/2);return;
  }
 }
 throw Error('Missing visible button: '+text);
};
const waitDisk = async (relative, text) => {
 for(let i=0;i<50;i++) {if(fs.readFileSync(path.join(root,relative),'utf8').includes(text))return;await new Promise(r=>setTimeout(r,100));}
 throw Error('Content not saved: '+relative);
};
const touchClient=await page.createCDPSession();
const swipe = async (from,to,cancel=false) => {
 await touchClient.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:from[0],y:from[1]}]});
 for(let step=1;step<=6;step++) {
  await touchClient.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:from[0]+(to[0]-from[0])*step/6,y:from[1]+(to[1]-from[1])*step/6}]});
 }
 await touchClient.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});
};
try {
 // Geometry uses rendered controls, not just body scrollWidth (the app clips overflow).
 for(const width of [320,390,430,820,1440]) {
  await page.setViewport({width,height:844,isMobile:width<768,hasTouch:width<1101,deviceScaleFactor:1});
  await page.goto(base+'/notes',{waitUntil:'networkidle0'});
  await fits('nav[aria-label="Main navigation"]');
  assert(!await page.evaluate(()=>[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='Agent access')),'Header access shortcut remains');
  if(width<1101) {
   await fits('button[aria-label="Notebooks and filters"]');
   if(width<768) {
    const nav=await bounds('nav');assert(nav.bottom===844&&nav.height>=64,'Mobile navigation is not at the bottom');
    const items=await page.$$eval('nav[aria-label="Main navigation"] button',buttons=>buttons.map(e=>({aria:e.getAttribute('aria-label'),icon:e.querySelector('svg').getBoundingClientRect().width,label:e.querySelector('span')?.getBoundingClientRect().height||0,height:e.getBoundingClientRect().height,width:e.getBoundingClientRect().width,radius:getComputedStyle(e).borderRadius})));
    assert(items.length===5&&items.every(item=>item.icon>=20&&item.height>=44),'Bottom navigation compresses icons or omits the center action');
    assert(items[2].aria==='New Note'&&items[2].width===items[2].height&&parseFloat(items[2].radius)>=items[2].width/2-1,'New Note is not a circular center navigation action');
    assert(await page.$$eval('[aria-label="New Note"]',buttons=>buttons.filter(e=>e.getBoundingClientRect().width>0).length)===1,'Mobile renders duplicate New Note actions');
   }
   if(width<768) {
    const row=await bounds('.note-list tbody tr');assert(row.height<=72,'Mobile List is not compact');
    assert(await page.$eval('.note-list tbody tr',e=>[e.children[2],e.children[3],e.querySelector('.font-mono')].every(node=>getComputedStyle(node).display==='none')),'Mobile List retains secondary information');
   }
   await page.screenshot({path:product+'/artifacts/qa/mobile-notes-'+width+'.png'});
   await fits('button[role="combobox"][aria-label="Note view"]');await fits('button[aria-label="New Note"]');
  }
  await page.goto(base+'/notebooks/example/notes/root.md',{waitUntil:'networkidle0'});
  await page.waitForSelector('.cm-content');await fits('button[aria-label="Close note"]');
  await fits('button[aria-label="Document tools"]');
  await fits('[data-markdown-editor]',Math.min(width-40,500));
  if(width<768) {
   assert((await bounds('.note-controls')).height<=48,'Note toolbar wraps on mobile');
   const close=await bounds('button[aria-label="Close note"]');assert(close.width>=44&&close.height>=44,'Small Close target');
   await page.screenshot({path:product+'/artifacts/qa/mobile-note-'+width+'.png'});
   if(width===320) {
    await tap('.note-panel-tabs [role="tab"][aria-label="Find in note"]');await fits('.note-document-panel[data-panel="find"]');await fits('.note-find-field');
    await page.keyboard.press('Escape');
    await tap('.note-panel-tabs [role="tab"][aria-label="Outline"]');await fits('.note-document-panel[data-panel="outline"]');
    assert((await bounds('.note-document-panel')).width<=320,'Mobile document panel is too wide');
    await page.screenshot({path:product+'/artifacts/qa/mobile-note-outline.png'});
    await page.keyboard.press('Escape');assert(await page.$('[aria-label="Note editor"]'),'Outline Escape closed the note');
   }
  }
  await page.goto(base+'/agent',{waitUntil:'networkidle0'});await page.waitForSelector('.cm-content');
  await fits('[data-markdown-editor]',Math.min(width-40,500));
  if(width<768) {await fits('button[role="combobox"][aria-label="Agent document"]');assert((await bounds('.agent-toolbar')).height<=64,'Agent toolbar wraps on mobile');}
  console.log('PASS responsive geometry at '+width+' px');
 }
 await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
 await page.goto(base+'/notes',{waitUntil:'networkidle0'});
 const recoveryKey=`gh_notes_draft:local:${root}:main:notes/example/root.md`;
 await page.evaluate(key=>localStorage.setItem(key,JSON.stringify({path:'notes/example/root.md',content:'# Root Note\nRecovered mobile draft\n',metadata:{},savedAt:Date.now()})),recoveryKey);
 await page.goto(base+'/notebooks/example/notes/root.md',{waitUntil:'networkidle0'});await page.waitForSelector('.editor-notice-actions');
 await page.setViewport({width:320,height:420,isMobile:true,hasTouch:true});
 await fits('.editor-notice-actions');
 assert(await page.$$eval('.editor-notice-actions button',buttons=>buttons.every(b=>getComputedStyle(b).whiteSpace==='nowrap'&&b.getBoundingClientRect().height>=44)),'Recovery actions wrap or have small targets');
 assert((await bounds('[data-markdown-editor]')).height>=100,'Recovery notice consumes the editor');
 await page.screenshot({path:product+'/artifacts/qa/mobile-recovery.png'});
 await tap('button[role="combobox"][aria-label="Editor mode"]');await page.waitForSelector('[role="listbox"]');await fits('[role="listbox"]');
 await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('[role="listbox"]'));assert(await page.$('[aria-label="Note editor"]'),'Select Escape closed the note');
 await click('Restore Draft');await waitDisk('notes/example/root.md','Recovered mobile draft');
 await page.waitForFunction(()=>!document.querySelector('.editor-notice-actions'));
 await tap('.note-panel-tabs [role="tab"][aria-label="File Git status"]');await page.waitForSelector('.note-document-panel[data-panel="git"]');
 await tap('button[aria-label="Restore note"]');await fits('button[aria-label="Confirm restore note"]');assert((await bounds('.note-document-panel')).width<=320,'Note restore confirmation overflows panel');
 await tap('button[aria-label="Confirm restore note"]');await page.waitForFunction(()=>!document.querySelector('.cm-content')?.innerText.includes('Recovered mobile draft'));
 await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});await tap('[aria-label="Close note"]');await page.waitForFunction(()=>!document.querySelector('[aria-label="Note editor"]'));
 console.log('PASS bounded recovery, draft restore, note restore confirmation and select-only Escape');
 await swipe([12,250],[190,252]);await page.waitForSelector('[data-responsive-sidebar].is-open');
 assert(Math.abs((await bounds('#notebook-panel')).width-390*.75)<2,'Sidebar is not 75% wide');
 await page.waitForFunction(()=>document.querySelector('#notebook-panel').getBoundingClientRect().left>=0);
 await swipe([200,250],[30,251]);await page.waitForFunction(()=>!document.querySelector('[data-responsive-sidebar].is-open'));
 await page.waitForFunction(()=>document.querySelector('#notebook-panel').getBoundingClientRect().right<=1);
 await swipe([120,250],[280,250]);await page.waitForSelector('[data-responsive-sidebar].is-open');
 await swipe([200,250],[30,251]);await page.waitForFunction(()=>!document.querySelector('[data-responsive-sidebar].is-open'));
 await swipe([240,250],[380,250]);assert(!await page.$('[data-responsive-sidebar].is-open'),'Swipe starting in the right half opened sidebar');
 await swipe([12,250],[14,350]);assert(!await page.$('[data-responsive-sidebar].is-open'),'Vertical swipe opened sidebar');
 await swipe([12,250],[42,250]);assert(!await page.$('[data-responsive-sidebar].is-open'),'Short swipe opened sidebar');
 await swipe([12,250],[190,250],true);assert(!await page.$('[data-responsive-sidebar].is-open'),'Cancelled swipe opened sidebar');
 assert(!await page.$('[aria-label="Note editor"]'),'Swipe opened a note');
 console.log('PASS left-half swipe open, right-half/vertical/short/cancelled gestures and no accidental note');
 for(const route of ['/agent?notebook=example','/assets?notebook=example','/settings','/screen?notebook=example']) {
  await page.goto(base+route,{waitUntil:'networkidle0'});
  await tap('[data-sidebar-toggle]');await page.waitForSelector('[data-responsive-sidebar].is-open');
  const b=await bounds('[data-sidebar-backdrop]');await page.touchscreen.tap(b.right-20,250);await page.waitForFunction(()=>!document.querySelector('[data-responsive-sidebar].is-open'));
 }
 console.log('PASS mobile sidebar drawers on Agent, Assets, Settings and Screen');
 await page.goto(base+'/notes',{waitUntil:'networkidle0'});
 await tap('button[aria-label="Notebooks and filters"]');await page.waitForSelector('[data-responsive-sidebar].is-open');
 await page.touchscreen.tap(370,250);await page.waitForFunction(()=>!document.querySelector('[data-responsive-sidebar].is-open'));
 await tap('button[aria-label="Notebooks and filters"]');await page.waitForFunction(()=>document.querySelector('#notebook-panel').getBoundingClientRect().left>=0);await tap('#notebook-panel .folder-tree-item .nav-tree-entry[title^="projects"]');
 await page.touchscreen.tap(370,250);await page.waitForFunction(()=>!document.querySelector('[data-responsive-sidebar].is-open'));
 assert(page.url().includes('folder'),'Folder selection did not navigate');
 await page.goto(base+'/notes?view=card',{waitUntil:'networkidle0'});
 await chooseSelect(page, 'button[role="combobox"][aria-label="Status for Root Note"]','working');await waitDisk('notes/example/root.md','status: working');
 assert(!await page.$('[aria-label="Note editor"]'),'Card status opened note');
 await page.waitForSelector('.right-panel-rail [role="tab"][aria-label="Changes"] .right-panel-badge');await fits('.right-panel-rail');
 assert((await bounds('.right-panel-rail')).bottom<=(await bounds('nav')).y,'Changes rail overlaps bottom navigation');
 await tap('button[aria-label="Settings"]');
 await page.waitForSelector('#settings-manifest textarea');
 await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('GitHub Dark')).click());
 await page.waitForFunction(()=>document.documentElement.classList.contains('dark'));
 await click('Notes');
 for(const view of ['list','card']) {
  await chooseSelect(page, 'button[role="combobox"][aria-label="Note view"]',view);await page.waitForFunction(expected=>{const current=new URL(location.href).searchParams.get('view');return expected==='list'?!current||current==='list':current===expected;},{},view);await page.waitForSelector('button[role="combobox"][aria-label="Status for Root Note"]');
  await tap('button[role="combobox"][aria-label="Status for Root Note"]');await page.waitForSelector('[role="listbox"]');await fits('[role="listbox"]');
  const option=await page.$eval('.select-popup',e=>({color:getComputedStyle(e).color,background:getComputedStyle(e).backgroundColor}));
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('[role="listbox"]'));
  const rgb=color=>color.match(/\d+/g).slice(0,3).map(Number);
  const lum=color=>rgb(color).map(v=>v/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[0.2126,0.7152,0.0722][i],0);
  const a=lum(option.color),b=lum(option.background);assert((Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)>=4.5,'Low contrast dark status options');
  const input=await page.$eval('.header-search input',e=>({caret:getComputedStyle(e).caretColor,background:getComputedStyle(e).backgroundColor}));
  const c=lum(input.caret),d=lum(input.background);assert((Math.max(c,d)+0.05)/(Math.min(c,d)+0.05)>=4.5,'Dark input caret lacks contrast');
 }
 console.log('PASS dark List/Card select option contrast');
 await chooseSelect(page, 'button[role="combobox"][aria-label="Note view"]','kanban');await page.waitForSelector('[data-notepath]');
 await tap('button[aria-label="Settings"]');await page.waitForSelector('input[aria-label="MCP client name"]');
 await page.$eval('input[aria-label="MCP client name"]',e=>e.scrollIntoView());await fits('input[aria-label="MCP client name"]');
 await tap('button[aria-label="Settings"]');
 assert(await page.evaluate(()=>document.body.innerText.includes('MCP Access Control')),'Settings access section missing');
 console.log('PASS touch navigation, notebook filters, Card status and Settings access');
 await click('Notes');await tap('button[aria-label="New Note"]');
 assert(await page.$eval('input[aria-label="Folder path"]',input=>input.value)==='','New note folder does not default to notebook root');
 assert(await page.$$eval('#create-note-folders option',options=>options.map(option=>option.value).join(',')==='projects,projects/deep'),'Folder path autocomplete does not list notebook folders');
 await page.type('input[aria-label="Folder path"]','projects/deep');
 await page.type('input[placeholder="e.g. Sprint Planning, Project Ideas..."]','Mobile draft');
 await click('Create Note');await page.waitForSelector('.cm-content');
 await tap('.cm-content');await page.keyboard.down('Control');await page.keyboard.press('End');await page.keyboard.up('Control');
 await page.keyboard.type('\nMobile live edit');
 await page.waitForSelector('.cm-cursor');
 assert(await page.$eval('.cm-cursor',e=>parseFloat(getComputedStyle(e).borderLeftWidth)>=2),'Dark live caret is too thin');
 assert(await page.$eval('.cm-cursor',e=>getComputedStyle(e).borderLeftColor===getComputedStyle(document.querySelector('.header-search input')).caretColor),'Dark live caret does not use readable foreground');
 await click('Source');await page.waitForSelector('textarea[aria-label="Note content"]');
 assert(await page.$eval('textarea[aria-label="Note content"]',e=>e.value.includes('Mobile live edit')),'Mode switch lost mobile edit');
 assert(await page.$eval('textarea[aria-label="Note content"]',e=>getComputedStyle(e).caretColor===getComputedStyle(document.querySelector('.header-search input')).caretColor),'Dark source caret differs from input foreground');
 const noteFile=await page.$eval('.note-heading',e=>e.querySelector('.font-mono').textContent);
 assert(noteFile.startsWith('notes/example/projects/deep/'),'Selected folder path was not used for the new note');
 await waitDisk(noteFile,'Mobile live edit');
 await tap('.note-panel-tabs [role="tab"][aria-label="Frontmatter"]');await page.waitForSelector('.note-document-panel[data-panel="frontmatter"] .note-metadata');
 await fits('.note-document-panel');
 assert(await page.$$eval('.note-panel-tabs [role="tab"]',buttons=>buttons.map(button=>button.getAttribute('aria-label')).join(',')==='Find in note,Outline,Frontmatter,Insert image,File Git status'),'Mobile document panel tabs are incomplete');
 await page.$eval('.note-metadata input',e=>e.scrollIntoView());
 assert(await page.$eval('.note-metadata input',e=>parseFloat(getComputedStyle(e).fontSize)>=16),'Metadata input triggers mobile zoom');
 await tap('.note-panel-tabs [role="tab"][aria-label="Frontmatter"]');await page.waitForSelector('.note-document-panel[data-open="false"]');
 // Resizing emulates the layout consequence of a software keyboard, not native IME behavior.
 await page.setViewport({width:390,height:420,isMobile:true,hasTouch:true});
 await page.waitForFunction(()=>parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--visual-height'))<430);
 await fits('[aria-label="Close note"]');await fits('[data-markdown-editor]',350);
 assert((await bounds('[data-markdown-editor]')).height>=100,'Keyboard leaves too little note editing space');
 await tap('textarea[aria-label="Note content"]');await page.keyboard.down('Control');await page.keyboard.press('End');await page.keyboard.up('Control');await page.keyboard.type('\nReduced viewport edit');
 await waitDisk(noteFile,'Reduced viewport edit');
 await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
 await page.waitForFunction(()=>parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--visual-height'))>800);
 await tap('.note-panel-tabs [role="tab"][aria-label="Insert image"]');await page.waitForSelector('.note-document-panel[data-panel="assets"]');
 await tap('.note-document-panel[data-panel="assets"] button[aria-label="Open folder: assets"]');
 await tap('.note-document-panel[data-panel="assets"] button[aria-label="Select file: pixel.png"]');await page.waitForSelector('.note-document-panel[data-panel="assets"] .file-detail img');
 await click('Insert image');await page.waitForSelector('.note-document-panel[data-open="false"]');
 await waitDisk(noteFile,'/raw-assets/by-hash/');
 await tap('[aria-label="Close note"]');await page.waitForFunction(()=>!document.querySelector('[aria-label="Note editor"]'));
 await tap('button[aria-label="Agent System"]');await page.waitForSelector('.cm-content[aria-label="Agent document content"]');
 await page.setViewport({width:320,height:420,isMobile:true,hasTouch:true});
 await tap('[data-sidebar-toggle]');await page.waitForSelector('[data-responsive-sidebar].is-open');await page.waitForFunction(()=>document.querySelector('[data-responsive-sidebar]').getBoundingClientRect().left>=0);await fits('[data-responsive-sidebar]',200);await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('[data-responsive-sidebar].is-open'));
 await fits('[data-markdown-editor]',250);const reducedAgentEditor=await bounds('[data-markdown-editor]');assert(reducedAgentEditor.height>=100,`Agent toolbar consumes reduced viewport: ${JSON.stringify(reducedAgentEditor)}`);
 await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
 await page.waitForFunction(()=>document.querySelector('.cm-content')?.textContent.includes('Workspace Guidelines'));
 await tap('.cm-content');await page.keyboard.down('Control');await page.keyboard.press('End');await page.keyboard.up('Control');await page.keyboard.type('\nMobile agent edit');
 await waitDisk('notes/AGENTS.md','Mobile agent edit');
 await page.setViewport({width:320,height:844,isMobile:true,hasTouch:true});
 await page.waitForSelector('button[aria-label="Restore"]:not(:disabled)'); await tap('button[aria-label="Restore"]');
 await fits('button[aria-label="Confirm Restore?"]');
 assert((await bounds('.agent-toolbar')).height<=64,'Agent restore confirmation wraps toolbar');
 await tap('button[aria-label="Confirm Restore?"]');
 await page.waitForFunction(()=>document.querySelector('.cm-content')?.innerText.includes('Use Markdown notes.')&&!document.querySelector('.cm-content')?.innerText.includes('Mobile agent edit'));
 // Restore swaps the content before its git status refresh ends; navigation waits for that.
 await page.waitForSelector('button[aria-label="Agent document"]:not(:disabled)');
 await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
 await page.screenshot({path:product+'/artifacts/qa/mobile-agent.png'});
 await click('Files');await page.waitForSelector('.file-manager-toolbar');await fits('.file-manager-toolbar');
 assert(new URL(page.url()).pathname==='/files','Files bottom navigation did not navigate');
 await page.screenshot({path:product+'/artifacts/qa/mobile-assets.png'});
 console.log('PASS mobile create, Live/Source, reduced-height editing, image insert, Agent save and Files navigation');
 // Hosted saving and access settings use fixture credentials and intercepted API calls.
 let saved;
 const remoteNote={path:'notes/example/remote.md',title:'Remote note',content:'# Remote note\n',metadata:{title:'Remote note'},status:'inbox',tags:[],notebookId:'example',revision:'one'};
 await page.setRequestInterception(true);
 page.on('request',request=>{
  const url=new URL(request.url());let body;
  if(url.pathname==='/api/workspace')body={config:{schema_version:1,workspace:{title:'Mobile GitHub',default_notebook:'example'},notebooks:[{id:'example',title:'Example',root:'notes/example'}]},branch:'main',repoRoot:'',gitStatus:{branch:'main',isClean:true,staged:[],modified:[],untracked:[]},source:{type:'github',identity:'github:owner/repo@main'},capabilities:{write:true,local:false},revision:remoteNote.revision};
  if(url.pathname==='/api/notes') {if(request.method()==='POST'){saved=JSON.parse(request.postData());Object.assign(remoteNote,saved,{revision:'two'});body={note:remoteNote,commit:{commitHash:'two'}};}else body={notes:[remoteNote]};}
  if(url.pathname==='/api/notes/commit'){const payload=JSON.parse(request.postData());saved={...payload.notes[0],revision:payload.revision};Object.assign(remoteNote,saved,{revision:'two'});body={revision:'two',commit:{commitHash:'two'}};}
  if(url.pathname==='/api/notes/read')body={note:remoteNote};
  if(url.pathname==='/api/notes/read-batch')body={notes:[remoteNote]};
  if(url.pathname==='/api/notes/query')body=url.searchParams.get('select')==='paths'?{revision:remoteNote.revision,paths:[remoteNote.path],total:1}:{revision:remoteNote.revision,notes:[remoteNote],total:1,nextCursor:null};
  if(url.pathname==='/api/notes/lookup')body={revision:remoteNote.revision,notes:[remoteNote]};
  if(url.pathname==='/api/notes/facets')body={revision:remoteNote.revision,notebooks:{example:{total:1,hidden:0,statuses:{inbox:1},tags:{},directories:{'notes/example':1}}}};
  if(url.pathname==='/api/notes/agenda')body={revision:remoteNote.revision,tasks:[],dated:[]};
  if(url.pathname==='/api/folders')body={folders:[]};if(url.pathname==='/api/assets')body={assets:[]};
  if(url.pathname==='/api/auth/session')body={authenticated:true,login:'mobile-owner',configured:true,provider:'github'};
  if(url.pathname==='/api/auth/agent-tokens')body={grants:[]};
  if(url.pathname==='/api/git/status')body={status:{branch:'main',isClean:true,staged:[],modified:[],untracked:[]},commits:[]};
  if(body)void request.respond({status:200,contentType:'application/json',body:JSON.stringify(body)});else void request.continue();
 });
 await page.goto(base+'/notebooks/example/notes/remote.md',{waitUntil:'networkidle0'});await page.waitForSelector('.cm-content');
 await click('Source');await tap('textarea[aria-label="Note content"]');await page.keyboard.down('Control');await page.keyboard.press('End');await page.keyboard.up('Control');await page.keyboard.type('\nMobile remote save');
 await page.setViewport({width:320,height:420,isMobile:true,hasTouch:true});
 await fits('[aria-label="Close note"]');await fits('button[aria-label="Document tools"]');
 await page.waitForFunction(()=>document.body.innerText.includes('Saved locally'));
 assert(!saved,'Editing committed before explicit Commit');
 await tap('[aria-label="Close note"]');await tap('.right-panel-rail [role="tab"][aria-label="Changes"]');await tap('button[aria-label="Commit notes/example/remote.md"]');await page.waitForSelector('dialog[aria-label="Changes"]');
 const commitLabel = await page.evaluate(() => [...document.querySelectorAll('dialog button')].find(b => b.textContent.includes('Commit selected'))?.textContent.trim());
 await click(commitLabel);await page.waitForFunction(()=>!document.querySelector('dialog[aria-label="Changes"]'));
 assert(saved?.content.includes('Mobile remote save')&&saved.revision==='one','Remote save lost content or revision');
 await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});await page.waitForFunction(()=>document.querySelector('nav').getBoundingClientRect().bottom===844);await tap('button[aria-label="Settings"]');
 await page.waitForSelector('input[aria-label="MCP client name"]');assert(!await page.$eval('input[aria-label="MCP client name"]',e=>e.disabled),'Authenticated access disabled');
 assert(!await page.evaluate(()=>[...document.querySelectorAll('button')].some(e=>e.textContent==='Agent access')),'Remote shortcut remains');
 await tap('summary[aria-label="mobile-owner"]');
 assert(await page.evaluate(()=>document.body.innerText.includes('mobile-owner')&&document.body.innerText.includes('Sign out')),'Account controls removed');
 assert(errors.length===0,errors.join('; '));console.log('PASS mobile GitHub revision-aware save, account controls and Settings-only access; no runtime errors');
} catch(error) {console.log(await page.evaluate(()=>({url:location.href,text:document.body.innerText.slice(-2000)})));throw error;} finally {await browser.close();await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true});}
