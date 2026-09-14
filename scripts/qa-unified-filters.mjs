import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
const product = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
fs.mkdirSync(path.join(product, 'artifacts/qa'), { recursive: true });
const require = createRequire(`${product}/apps/web/package.json`);
const puppeteer = require('puppeteer-core');
const { stringify } = require('yaml');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-filters-'));
const write = (name, text) => { fs.mkdirSync(path.dirname(path.join(root,name)),{recursive:true});fs.writeFileSync(path.join(root,name),text); };
write('.github-notes.yaml', stringify({schema_version:1,workspace:{title:'Filter QA',default_notebook:'a'},notebooks:[{id:'a',title:'Alpha',root:'notes/a'},{id:'b',title:'Beta',root:'notes/b'}]}));
const notes = [
 ['notes/a/research/one.md','One',['red','blue'],'needle [[two]]','inbox'],
 ['notes/a/research/nested/two.md','Two',['blue'],'[[three]]','inbox'],
 ['notes/a/research-extra/three.md','Three',['red'],'[[four]]','inbox'],
 ['notes/a/other/four.md','Four',['green'],'','inbox'],
 ['notes/b/research/five.md','Five',['blue'],'','inbox'],
 ['notes/a/research/hidden.md','Hidden',['red'],'','archived'],
 ['notes/a/research/visible.md','Visible',['red'],'','archived',false],
];
for (const [file,title,tags,content,status,hiden] of notes) write(file,'---\n'+stringify({title,tags,status,...(hiden!==undefined?{hiden}:{})})+'---\n'+content+'\n');
write('.github-notes-screen.yaml', stringify({version:1,rows:[{id:'lane1',kind:'custom',name:'First lane',view:'small',items:[{kind:'note',id:'item1',notebookId:'a',path:notes[0][0]}]},{id:'lane2',kind:'custom',name:'Second lane',view:'small',items:[]}]}));
const git = (...args) => execFileSync('git',args,{cwd:root,stdio:'pipe'});
git('init','-b','main');git('config','user.name','QA');git('config','user.email','qa@example.com');git('add','.');git('commit','-m','fixture');
process.env.GITHUB_NOTES_SOURCE='local';process.env.GITHUB_NOTES_LOCAL_PATH=root;delete process.env.VERCEL;delete process.env.APP_URL;
const {createApp} = await import(`${product}/apps/local-server/dist/app.js`);
const server=createServer(createApp(product));await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser = await puppeteer.launch({executablePath:process.env.CHROME_PATH || path.join(os.homedir(),'.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome'),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const errors=[]; const results=[];
const base=`http://127.0.0.1:${server.address().port}`;
let page;
try {
 page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.evaluateOnNewDocument(()=>localStorage.setItem('github-notes:language','en'));
 await page.setViewport({width:1440,height:950});
 const go=async(route)=>{await page.goto(base+route,{waitUntil:'networkidle0'});await page.waitForSelector('.app-shell');};
 const count=async(n)=>{await page.waitForFunction(n=>document.querySelector('[data-filter-results]')?.getAttribute('data-filter-results')===String(n),{},n);};
 const checkbox=async(label)=>{await page.evaluate(label=>{const target=[...document.querySelectorAll('.workspace-filters label')].find(el=>el.textContent.trim()===label);if(!target)throw Error('Missing checkbox '+label);target.querySelector('input[type=checkbox]').click();},label);};
 const select=async(label,value)=>{await page.evaluate((label,value)=>{const el=[...document.querySelectorAll('.workspace-filters label')].find(el=>el.firstChild?.textContent===label)?.querySelector('select');if(!el)throw Error('Missing select '+label);el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));},label,value);};
 const open=async()=>{if(await page.$('.filter-details')===null)await page.click('.filter-trigger');await page.waitForSelector('.filter-details');};
 await go('/notebooks/a');await count(5);
 assert.equal(await page.$('.folder-grip'),null);await page.click('.reorder-toggle');await page.waitForSelector('.folder-grip');await page.click('.reorder-toggle');assert.equal(await page.$('.folder-grip'),null);
 results.push('Folder handles hidden by default and toggled by icon');
 await open();await checkbox('#blue');await count(2);await checkbox('#red');await count(4);assert.ok(await page.$('.filter-details'));
 await select('Match tags','all');await count(1);await page.keyboard.press('Escape');assert.equal(await page.$('.filter-details'),null);assert.equal(await page.evaluate(()=>document.activeElement?.classList.contains('filter-trigger')),true);
 results.push('Tag any/all, panel stays open, Escape restores focus');
 await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='View graph').click());await page.waitForSelector('.graph-page-container');await count(1);assert.equal(await page.$('.filter-details'),null);
 assert.equal(new URL(page.url()).searchParams.getAll('tag').length,2);
 await open();await checkbox('Show directly connected notes outside filters');await page.waitForFunction(()=>document.querySelector('[data-graph-nodes]')?.getAttribute('data-graph-nodes')==='2');
 await page.keyboard.press('Escape');await page.screenshot({path:product+'/artifacts/qa/unified-graph-collapsed.png'});
 const shared=page.url();await page.reload({waitUntil:'networkidle0'});await count(1);assert.equal(new URL(page.url()).searchParams.get('neighbors'),'true');
 await open();await checkbox('Show directly connected notes outside filters');await page.waitForFunction(()=>new URL(location.href).searchParams.get('neighbors')===null);await page.goBack({waitUntil:'networkidle0'});await page.waitForFunction(()=>document.querySelector('[data-graph-nodes]')?.getAttribute('data-graph-nodes')==='2');await page.goForward({waitUntil:'networkidle0'});await page.waitForFunction(()=>document.querySelector('[data-graph-nodes]')?.getAttribute('data-graph-nodes')==='1');
 results.push('Graph transfer, one-hop neighbors, reload and history');
 await go('/notebooks/a?folders=notes/a/research&folders=notes/a/other');await count(4);await open();await checkbox('Include subfolders');await count(3);await checkbox('Include subfolders');await count(4);
 await page.screenshot({path:product+'/artifacts/qa/unified-notebook-filters.png'});
 await page.click('.filter-clear');await count(5);
 await page.type('.filter-search input','needle');await count(1);await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='View graph').click());await page.waitForSelector('.graph-page-container');await count(1);assert.equal(new URL(page.url()).searchParams.get('q'),'needle');
 results.push('Folders union/descendants, clear, immediate search and navigation');
 await go('/notebooks/a/folders/research?view=graph&tag=blue');await page.waitForSelector('.graph-page-container');await count(2);assert.equal(new URL(page.url()).pathname,'/graph');assert.deepEqual(new URL(page.url()).searchParams.getAll('folders'),['notes/a/research']);
 await go('/graph?notebook=a&folders=notes/a/missing');await count(0);await open();assert.ok(await page.evaluate(()=>document.querySelector('.filter-chips').textContent.includes('notes/a/missing')));await page.click('.filter-clear');await count(5);
 results.push('Legacy graph redirect and missing-folder removal');
 await go('/graph?notebook=a&q=needle&tag=red&tag=blue&tagMode=all');await count(1);
 const graphOrigin=page.url();
 await new Promise(resolve=>setTimeout(resolve,1800));
 const canvas=await page.$('.graph-page-container canvas');const rect=await canvas.boundingBox();await page.mouse.click(rect.x+rect.width/2,rect.y+rect.height/2);
 await page.waitForSelector('aside[aria-label="Note preview"]');
 await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Open full editor').click());await page.waitForSelector('[aria-label="Close note"]');
 await page.reload({waitUntil:'networkidle0'});await page.waitForSelector('[aria-label="Close note"]');await page.click('[aria-label="Close note"]');await count(1);assert.equal(page.url(),graphOrigin);
 await page.evaluate(()=>document.querySelector('nav[aria-label="Main navigation"] button[aria-label="Notes"]').click());await page.waitForSelector('.notes-main');await count(1);assert.deepEqual(new URL(page.url()).searchParams.getAll('tag'),['red','blue']);
 const noteOrigin=page.url();await page.evaluate(()=>[...document.querySelectorAll('.notes-main tr')].find(b=>b.textContent.includes('One')).click());await page.waitForSelector('[aria-label="Close note"]');await page.click('[aria-label="Close note"]');assert.equal(page.url(),noteOrigin);
 results.push('Actual graph and notebook editor open/close, editor reload, reverse page transfer');
 await go('/graph?notebook=all');await count(6);await open();await checkbox('Show hidden notes');await count(7);
 await checkbox('Beta / research');await count(1);await page.keyboard.press('Escape');
 await page.waitForFunction(()=>new URL(location.href).searchParams.get('folders')==='notes/b/research');
 const copy=await browser.newPage();await copy.goto(page.url(),{waitUntil:'networkidle0'});assert.equal(await copy.$eval('[data-filter-results]',el=>el.getAttribute('data-filter-results')),'1');await copy.close();
 results.push('All notebooks, hidden eligibility, scoped folder and copied URL');
 for(const [width,height] of [[390,844],[820,460]]) {
   await page.setViewport({width,height});await go('/graph?notebook=a');await open();
   const bounds=await page.evaluate(()=>{const panel=document.querySelector('.filter-details').getBoundingClientRect();const canvas=document.querySelector('.graph-page-container').getBoundingClientRect();return {x:panel.x,right:panel.right,bottom:panel.bottom,width:innerWidth,height:innerHeight,canvasHeight:canvas.height};});
   assert.ok(bounds.x>=0&&bounds.right<=bounds.width&&bounds.bottom<=bounds.height,JSON.stringify(bounds));assert.ok(bounds.canvasHeight>150);
   await page.screenshot({path:product+`/artifacts/qa/unified-graph-${width}.png`});
 }
 results.push('Compact panel fits mobile and short viewport');
 await page.setViewport({width:1440,height:950});await go('/screen?notebook=a');await page.keyboard.press('[');await page.waitForSelector('.screen-sidebar-lane');await page.waitForFunction(()=>document.querySelector('.screen-sidebar')?.getBoundingClientRect().width>150);assert.equal(await page.$('.screen-drag-handle'),null);await page.click('.reorder-toggle');await page.waitForSelector('.screen-drag-handle');assert.equal(await page.evaluate(()=>document.querySelector('.reorder-toggle').textContent),'');const handle=await page.$('.screen-sidebar-lane .screen-drag-handle');await handle.focus();await page.keyboard.press('Space');await new Promise(resolve=>setTimeout(resolve,120));await page.keyboard.press('ArrowDown');await new Promise(resolve=>setTimeout(resolve,120));await page.keyboard.press('Space');await page.waitForFunction(()=>document.querySelector('.screen-sidebar-lane .screen-sidebar-action').textContent.includes('Second lane'));
 await page.click('.reorder-toggle');assert.equal(await page.$('.screen-drag-handle'),null);
 results.push('Lane/card handles default hidden, icon toggle and actual keyboard reorder');
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({results,errors,shared},null,2));fs.writeFileSync(product+'/artifacts/qa/unified-filters-results.json',JSON.stringify({results,errors},null,2));
} catch(error) {if(page){console.log('URL',page.url());console.log((await page.evaluate(()=>document.body.innerText)).slice(0,4500));await page.screenshot({path:product+'/artifacts/qa/unified-filters-failure.png'});}console.log('Errors',errors);throw error;}
finally {await browser.close();await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true});}
