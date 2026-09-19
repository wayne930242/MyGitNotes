import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { resolveQaChromePath } from './qa-chrome.mjs';

const product = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(`${product}/apps/web/package.json`);
const puppeteer = require('puppeteer-core');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'github-notes-agent-qa-'));
const write = (file, content) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
};
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
write('.github-notes.yaml', 'schema_version: 1\nworkspace:\n  title: Agent workspace\n  default_notebook: example\nnotebooks:\n  - id: example\n    title: Example\n    root: notes/example\n');
write('notes/example/intro.md', '# Example\n');
write('AGENTS.md', '# Workspace Rules\n\nKeep our custom instructions.\n');
write('.agents/skills/custom/SKILL.md', '---\nname: Custom skill\n---\n# Custom skill\n');
write('.agents/skills/custom/agents/openai.yaml', 'interface:\n  display_name: Custom\ncustom_field: keep\n');
write('.agents/skills/custom/references/check.md', '# Reference\n');
write('.agents/docs/setup.md', '# Setup\n');
const nativeDocuments = { 'CLAUDE.md': '# Claude instructions\n', '.claude/CLAUDE.md': '# Claude scoped instructions\n', '.claude/skills/review/SKILL.md': '# Claude skill\n', 'GEMINI.md': '# Antigravity instructions\n', '.agent/skills/review/SKILL.md': '# Antigravity legacy skill\n', '.agents/skills/format-tests.md': '# Antigravity command\n' };
for (const [file, content] of Object.entries(nativeDocuments)) write(file, content);
write('.claude/settings.local.json', '{"secret":"fixture-only"}');
write('.codex/agents/reviewer.toml', 'description = "Reviewer"\n');
write('.codex/auth.json', '{"token":"fixture-only"}');
git('init', '-b', 'main');
git('config', 'user.name', 'QA');
git('config', 'user.email', 'qa@example.com');
git('add', '.');
git('commit', '-m', 'fixture');
process.env.MYGITNOTES_SOURCE = 'local';
process.env.MYGITNOTES_LOCAL_PATH = root;
delete process.env.VERCEL;
delete process.env.APP_URL;
const { createApp } = await import(`${product}/apps/local-server/dist/app.js`);
const server = createServer(createApp(product));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: resolveQaChromePath(), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const click = async label => {
    await page.waitForFunction(label => [...document.querySelectorAll('button')].some(button => button.textContent.trim() === label && !button.disabled), {}, label);
    await page.evaluate(label => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === label && !button.disabled).click(), label);
  };
  const editor = 'textarea[aria-label="Agent document content"]';
  const revealFile = async file => {
    // Expand only the ancestors needed to reach the actual file button.
    for (const ancestor of file.split('/').slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join('/'))) {
      await page.evaluate(ancestor => {
        const folder = [...document.querySelectorAll('button.agent-folder')].find(button => button.title === ancestor);
        if (folder?.getAttribute('aria-expanded') === 'false') folder.click();
      }, ancestor);
    }
    await page.waitForFunction(file => [...document.querySelectorAll('button.agent-file')].some(button => button.title.split('\n')[0] === file && !button.disabled), {}, file);
  };
  const selectFile = async file => {
    await revealFile(file);
    await page.evaluate(file => [...document.querySelectorAll('button.agent-file')].find(button => button.title.split('\n')[0] === file).click(), file);
  };
  const append = async text => {
    await page.focus(editor);
    await page.keyboard.down('Control');
    await page.keyboard.press('End');
    await page.keyboard.up('Control');
    await page.keyboard.type(text);
  };
  await page.goto(base + '/agent', { waitUntil: 'networkidle0' });
  await click('Source');
  await page.waitForSelector(editor);
  if (!await page.$eval(editor, e => e.value.includes('# Workspace Rules'))) throw Error('Root workspace instructions were not the initial document');
  if (!await page.$('.agent-content > .note-footer')) throw Error('Agent documents do not use the note footer');
  if (await page.$('.agent-toolbar [role="status"], .agent-save-status')) throw Error('Agent toolbar still has a separate save indicator');
  if (await page.$eval('.note-footer [role="status"]', e => e.textContent.trim()) !== 'Saved') throw Error('Agent saved status is not concise');
  const sections = await page.$$eval('.agent-sidebar section', nodes => nodes.map(node => node.getAttribute('aria-label')));
  if (sections[0] !== 'Workspace skills' || sections.indexOf('Shared workspace') < 1) throw Error('Skills were not presented before shared documents');
  if (await page.$eval(editor, e => e.readOnly)) throw Error('Root Agent instructions remained read-only');
  if (await page.evaluate(() => document.body.innerText.includes('auth.json'))) throw Error('Secret appeared in resource list');
  await append('\nRoot edited in browser');
  await selectFile('.agents/skills/custom/SKILL.md');
  await page.waitForFunction(() => document.querySelector('textarea[aria-label="Agent document content"]')?.value.includes('# Custom skill'));
  if (!fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8').includes('Root edited in browser')) throw Error('Root edit was lost on switch');
  await append('\nSkill edited in browser');
  await selectFile('.agents/skills/custom/agents/openai.yaml');
  await page.waitForFunction(() => document.querySelector('textarea[aria-label="Agent document content"]')?.value.includes('custom_field: keep'));
  if (await page.$eval(editor, e => e.readOnly)) throw Error('Skill interface settings remained read-only');
  await append('\n# Interface edited in browser');
  await selectFile('AGENTS.md');
  await page.waitForFunction(() => document.querySelector('textarea[aria-label="Agent document content"]')?.value.includes('Root edited in browser'));
  if (!fs.readFileSync(path.join(root, '.agents/skills/custom/SKILL.md'), 'utf8').includes('Skill edited in browser')) throw Error('Skill edit was lost');
  const interfaceContent = fs.readFileSync(path.join(root, '.agents/skills/custom/agents/openai.yaml'), 'utf8');
  if (!interfaceContent.includes('custom_field: keep') || !interfaceContent.includes('Interface edited in browser')) throw Error('Skill interface edit or custom field was lost');
  for (const [file, original] of Object.entries(nativeDocuments)) {
    await selectFile(file);
    await page.waitForFunction(original => document.querySelector('textarea[aria-label="Agent document content"]')?.value === original, {}, original);
    if (await page.$eval(editor, e => e.readOnly)) throw Error(`Native document remained read-only: ${file}`);
    await append('\nNative document edited in browser');
    await selectFile('AGENTS.md');
    await page.waitForFunction(() => document.querySelector('textarea[aria-label="Agent document content"]')?.value.includes('Root edited in browser'));
    if (!fs.readFileSync(path.join(root, file), 'utf8').includes('Native document edited in browser')) throw Error(`Native edit lost: ${file}`);
  }
  const resources = await fetch(base + '/api/agent-resources').then(response => response.json());
  if (JSON.stringify(resources).includes('settings.local.json')) throw Error('Private Claude settings were exposed');
  await click('Restore');
  await click('Confirm Restore?');
  await page.waitForFunction(() => !document.querySelector('textarea[aria-label="Agent document content"]')?.value.includes('Root edited in browser'));
  if (fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8') !== '# Workspace Rules\n\nKeep our custom instructions.\n') throw Error('Restore did not preserve original root rules');
  const receipt = await fetch(base + '/api/git/commit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files: ['.agents/skills/custom/SKILL.md'], message: 'docs(workspace): update custom skill' }) });
  if (!receipt.ok || !git('show', 'HEAD:.agents/skills/custom/SKILL.md').includes('Skill edited in browser')) throw Error('Agent settings could not be committed');
  fs.mkdirSync(path.join(product, 'artifacts/qa'), { recursive: true });
  await page.screenshot({ path: path.join(product, 'artifacts/qa/workspace-agent-system.png'), fullPage: true });
  await page.setViewport({ width: 390, height: 844 });
  // Mobile picks agent documents from the sidebar drawer, which closes after a choice.
  await page.waitForSelector('.workspace-responsive-sidebar');
  await (await page.waitForSelector('[data-sidebar-toggle]', { visible: true })).click();
  await page.waitForSelector('.workspace-responsive-sidebar.is-open');
  const mobileSections = await page.$$eval('.agent-sidebar section', nodes => nodes.map(node => node.getAttribute('aria-label')));
  if (mobileSections[0] !== 'Workspace skills') throw Error('Mobile drawer did not prioritize workspace skills');
  for (const file of Object.keys(nativeDocuments)) await revealFile(file);
  await selectFile('.agents/skills/custom/agents/openai.yaml');
  await page.waitForFunction(() => !document.querySelector('.workspace-responsive-sidebar.is-open'));
  await page.waitForFunction(() => document.querySelector('textarea[aria-label="Agent document content"]')?.value.includes('Interface edited in browser'));
  await page.screenshot({ path: path.join(product, 'artifacts/qa/workspace-agent-skills-mobile.png'), fullPage: true });
  const footerBounds = await page.$eval('.note-footer', e => ({ left: e.getBoundingClientRect().left, right: e.getBoundingClientRect().right, bottom: e.getBoundingClientRect().bottom }));
  if (footerBounds.left < 0 || footerBounds.right > 390 || footerBounds.bottom > 844) throw Error('Mobile Agent footer is outside the viewport');
  await page.setViewport({ width: 1440, height: 1000 });
  git('checkout', '-b', 'core');
  await page.reload({ waitUntil: 'networkidle0' });
  await click('Source');
  await page.waitForSelector(editor);
  if (!await page.$eval(editor, e => e.readOnly)) throw Error('Core branch offered Agent editing');
  if (errors.length) throw Error(errors.join('; '));
  console.log('PASS Codex/Claude/Antigravity skills and instructions, desktop/mobile navigation, Markdown and interface YAML edits, switch flushing, Git restore, tracked skill commit, secret exclusion and Core read-only UI');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
}
