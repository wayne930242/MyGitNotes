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
write('notes/.github-notes.yaml','schema_version: 1\nworkspace:\n  title: Folder QA\n  default_notebook: example\nnotebooks:\n  - id: example\n    title: Example\n    root: notes/example\n');
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
const page=await browser.newPage();await page.setViewport({width:1440,height:1000});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const click=async text=>{
 const file = text === 'Workspace Guidelines' ? 'notes/AGENTS.md' : text === 'Notebook: Example Guidelines' ? 'notes/example/AGENTS.md' : null;
 if(file){await page.waitForFunction(file=>[...document.querySelectorAll('.agent-file')].some(button=>button.title.split('\n')[0]===file&&!button.disabled),{},file);await page.evaluate(file=>[...document.querySelectorAll('.agent-file')].find(button=>button.title.split('\n')[0]===file).click(),file);return;}
 await page.waitForFunction(text=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()===text&&!b.disabled),{},text);await page.evaluate(text=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===text&&!b.disabled).click(),text);
};
const agentText = 'textarea[aria-label="Agent document content"]';
// CodeMirror binds Mod-End (Command on macOS); the textarea needs the explicit editing command there.
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const append = async (selector, text) => { await page.focus(selector);await page.keyboard.down(mod);await page.keyboard.press('End',{commands:['MoveToEndOfDocument']});await page.keyboard.up(mod);await page.keyboard.type(text); };
let delayReads=false;let slowSave=false;let failSave=false;const savedRequests=[];
await page.setRequestInterception(true);
page.on('request',request=>{
 const url=new URL(request.url());
 if(url.pathname==='/api/agent-resources/save'){
  const payload=JSON.parse(request.postData());savedRequests.push(payload);
  if(failSave){void request.respond({status:500,contentType:'application/json',body:JSON.stringify({error:'Fixture save failure'})});return;}
  if(slowSave){slowSave=false;setTimeout(()=>void request.continue(),700);return;}
 }
 if(delayReads&&url.pathname==='/api/agent-resources/read'&&url.searchParams.get('path')==='notes/example/AGENTS.md'){setTimeout(()=>void request.continue(),800);return;}
 void request.continue();
});
try {
 await page.goto(base+'/settings',{waitUntil:'networkidle0'});
 await page.waitForFunction(()=>document.body.innerText.includes('MCP Access Control'));
 if(!await page.$eval('input[aria-label="MCP client name"]',e=>e.disabled))throw Error('Local source offered a hosted grant');
 if(!await page.evaluate(()=>document.body.innerText.includes('operating-system permissions')))throw Error('Local access explanation missing');
 console.log('PASS local Settings includes the shared Access Control section and form');
 await page.goto(base+'/notes?view=card',{waitUntil:'networkidle0'});
 await page.waitForSelector('button[role="combobox"][aria-label="Status for Root Note"]');
 const statusSaved = page.waitForResponse(r=>r.url().endsWith('/api/git/status')&&r.status()===200);
 await chooseSelect(page, 'button[role="combobox"][aria-label="Status for Root Note"]','done');
 await page.waitForFunction(()=>document.querySelector('button[role="combobox"][aria-label="Status for Root Note"]').value==='done');
 await statusSaved;
 if(await page.$('button[aria-label="Close note"]'))throw Error('Card status opened the note');
 if(!fs.readFileSync(path.join(root,'notes/example/root.md'),'utf8').includes('status: done'))throw Error('Card status not saved');
 await page.click('button[title="List View"]');await page.waitForSelector('tbody button[role="combobox"][aria-label="Status for Root Note"]');
 if(await page.$eval('tbody button[role="combobox"][aria-label="Status for Root Note"]',e=>e.value)!=='done')throw Error('List status differs from card');
 console.log('PASS Card and List share editable status with no note navigation');
 await page.goto(base+'/agent',{waitUntil:'networkidle0'});
 await page.waitForSelector('.cm-content[aria-label="Agent document content"][contenteditable="true"]');
 if(!await page.$eval('button[aria-label="Restore"]',e=>e.disabled))throw Error('Clean Agent file restore enabled while another note is dirty');
 await append('.cm-content','\nLive agent edit');
 await page.waitForFunction(()=>!document.querySelector('button[aria-label="Restore"]')?.disabled);
 await click('Source');await page.waitForSelector(agentText);
 if(!await page.$eval(agentText,e=>e.value.includes('Live agent edit')))throw Error('Mode switch lost agent content');
 slowSave=true;const before=savedRequests.length;
 await append(agentText,'\nQueue first');
 await page.waitForFunction(()=>document.body.innerText.includes('Saving…'));
 await append(agentText,' and second');
 await click('Notebook: Example Guidelines');
 await page.waitForFunction(()=>document.querySelector('textarea[aria-label="Agent document content"]')?.value.includes('# Notebook Guidelines'));
 const rootText=fs.readFileSync(path.join(root,'notes/AGENTS.md'),'utf8');
 if(!rootText.includes('Queue first and second'))throw Error('Switch did not flush latest edits');
 if(fs.readFileSync(path.join(root,'notes/example/AGENTS.md'),'utf8')!=='# Notebook Guidelines\n\nPreserve frontmatter.\n')throw Error('Previous contents overwrote new file');
 if(savedRequests.slice(before).some(r=>r.path!=='notes/AGENTS.md'))throw Error('Save bound to wrong path');
 console.log('PASS shared agent editor saves both modes and serializes pending edits before switching');
 await click('Workspace Guidelines');await page.waitForFunction(()=>document.querySelector('textarea[aria-label="Agent document content"]')?.value.includes('# Workspace Guidelines'));
 delayReads=true;
 const lateRead=page.waitForResponse(r=>{const u=new URL(r.url());return u.pathname==='/api/agent-resources/read'&&u.searchParams.get('path')==='notes/example/AGENTS.md';});
 await click('Notebook: Example Guidelines');await page.waitForFunction(()=>document.body.innerText.includes('Loading document…'));
 await click('Workspace Guidelines');
 await page.waitForFunction(()=>document.querySelector('textarea[aria-label="Agent document content"]')?.value.includes('# Workspace Guidelines'));
 // waitForNetworkIdle is unreliable while request interception is active; wait for the
 // specific delayed read to land instead, so its (discarded) response can't race the assertion
 // below. Puppeteer's response event only means headers arrived; the page still has to read the
 // body and apply (or discard) it through React state, so read the body ourselves and give that a
 // bounded settle window tied to this exact response, not a global network-idle signal.
 await (await lateRead).text();
 await new Promise(resolve => setTimeout(resolve, 250));
 const stillOnWorkspaceGuidelines = await page.evaluate(() => document.querySelector('textarea[aria-label="Agent document content"]')?.value.startsWith('# Workspace Guidelines') ?? false);
 if(!stillOnWorkspaceGuidelines)throw Error('Late read changed the active document');
 console.log('PASS late reads cannot replace the currently selected agent document');
 failSave=true;await append(agentText,'\nUnsaved retry');await click('Notebook: Example Guidelines');
 await page.waitForFunction(()=>document.querySelector('[role="alert"]')?.textContent.includes('Fixture save failure'));
 if(!await page.$eval(agentText,e=>e.value.includes('Unsaved retry')))throw Error('Failed save discarded the draft');
 failSave=false;await click('Notebook: Example Guidelines');await page.waitForFunction(()=>document.querySelector('textarea[aria-label="Agent document content"]')?.value.includes('# Notebook Guidelines'));
 await click('Workspace Guidelines');await page.waitForFunction(()=>document.querySelector('textarea[aria-label="Agent document content"]')?.value.includes('Unsaved retry'));
 await click('Restore');await click('Confirm Restore?');await page.waitForFunction(()=>document.querySelector('textarea[aria-label="Agent document content"]')?.value==='# Workspace Guidelines\n\nUse **Markdown** notes.\n');
 if(fs.readFileSync(path.join(root,'notes/AGENTS.md'),'utf8')!=='# Workspace Guidelines\n\nUse **Markdown** notes.\n')throw Error('Restore did not reach disk');
 if(!fs.readFileSync(path.join(root,'notes/example/root.md'),'utf8').includes('status: done'))throw Error('Agent restore changed another note');
 await page.waitForFunction(()=>document.querySelector('button[aria-label="Restore"]')?.disabled);
 await page.waitForSelector(`${agentText}:not([readonly])`);
 await append(agentText,'\nCommit this Agent file');
 await page.waitForFunction(()=>!document.querySelector('button[aria-label="Restore"]')?.disabled);
 await page.click('.right-panel-rail [role="tab"][aria-label="Changes"]'); await page.waitForSelector('.changes-tool'); await click('Manage changes'); await page.waitForSelector('.changes-dialog');
 await page.waitForSelector('button[aria-label="Stage notes/AGENTS.md"]:not(:disabled)');
 await page.click('button[aria-label="Stage notes/AGENTS.md"]');
 await page.waitForSelector('[data-change-path="notes/AGENTS.md"][data-side="staged"]');
 await page.waitForSelector('input[aria-label="Commit Message"]:not(:disabled)');
 await page.type('input[aria-label="Commit Message"]','docs(agent): selected file');
 await click('Commit & Save');
 await page.waitForFunction(()=>!document.querySelector('.changes-dialog'));
 await page.waitForFunction(()=>document.querySelector('button[aria-label="Restore"]')?.disabled);
 if(!fs.readFileSync(path.join(root,'notes/example/root.md'),'utf8').includes('status: done'))throw Error('Agent commit changed unrelated note');
 if(git('show','HEAD:notes/example/root.md').toString().includes('status: done'))throw Error('Agent commit included unrelated note');
 await click('Live Preview');await page.waitForSelector('.live-md-heading');
 fs.mkdirSync(path.join(product,'artifacts/qa'),{recursive:true});await page.screenshot({path:path.join(product,'artifacts/qa/shared-agent-editor.png'),fullPage:true});
 console.log('PASS failed save retains its draft and reclick restore uses Git HEAD');
 if(errors.length)throw Error(errors.join('; '));
 console.log('PASS no browser runtime errors');
} catch(error){console.log('Failure',await page.evaluate(()=>({url:location.pathname,alerts:[...document.querySelectorAll('[role="alert"]')].map(e=>e.textContent),text:document.body.innerText.slice(-2000)})));throw error;}
finally {await browser.close();await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true});}
