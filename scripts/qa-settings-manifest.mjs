import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectPageErrors, createQaWorkspace, launchQaBrowser, qaRequire, startQaServer } from './lib/qa-harness.mjs';

const require = qaRequire();
const { root, write, git, commitFixture } = createQaWorkspace('github-notes-manifest-');
write('notes/.github-notes.yaml', 'schema_version: 1\nworkspace:\n  title: Manifest QA\n  default_notebook: example\nfiles:\n  hide_dotfiles: true\npreferences:\n  defaultYoutubeDisplayMode: thumbnail\n  defaultShowLineNumbers: false\n  defaultFocusMode: false\nnotebooks:\n  - id: example\n    title: Example\n    root: notes/example\n    metadata:\n      - key: status\n        type: string\n        label: Status\n    pathAliases:\n      docs: notes/example\n');
write('notes/example/regular.md', '# Regular Note\n');
commitFixture();
const { server, base } = await startQaServer(root);
const browser = await launchQaBrowser(require);
const page = await browser.newPage();
const errors = collectPageErrors(page);
// The local workspace keeps its change stream (/api/workspace/events) open, so a page never reaches networkidle0.
const visit = route => page.goto(base + route, { waitUntil: 'networkidle2' });
try {
  await page.setViewport({ width: 1440, height: 1000 });
  await visit('/settings');
  for (const theme of ['flexoki', 'github', 'catppuccin', 'rose-pine', 'gruvbox', 'tokyo-night', 'carbon', 'solarized', 'everforest'].flatMap(family => [`${family}:light`, `${family}:dark`])) {
    await page.evaluate(theme => {
      localStorage.setItem('github_notes_theme', theme.split(':')[0]);
      localStorage.setItem('github_notes_theme_mode', theme.split(':')[1]);
    }, theme);
    await visit('/settings');
    await page.click('#settings-manifest [role="tab"]:first-child');
    await page.focus('#settings-manifest textarea');
    const colors = await page.$eval('#settings-manifest textarea', element => {
      const style = getComputedStyle(element);
      return { caret: style.caretColor, text: style.color, background: style.backgroundColor, readonly: element.readOnly, focused: element === document.activeElement };
    });
    assert(colors.focused && !colors.readonly);
    assert.equal(colors.caret, colors.text, `Manifest caret must match its text: ${theme}`);
    assert.notEqual(colors.caret, colors.background);
    const original = await page.$eval('#settings-manifest textarea', input => input.value);
    await page.keyboard.press('End');
    await page.keyboard.type(' # caret QA');
    assert(await page.$eval('#settings-manifest textarea', input => input.value.includes('# caret QA')), 'Focused textarea must accept keyboard input');
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await page.keyboard.type(original);
  }
  await page.setViewport({ width: 390, height: 844 });
  await page.evaluate(() => {
    localStorage.setItem('github_notes_theme', 'github');
    localStorage.setItem('github_notes_theme_mode', 'dark');
    localStorage.setItem('github-notes:language', 'en');
  });
  await visit('/settings');
  assert.equal(await page.$eval('#settings-manifest [role="tab"][aria-selected="true"]', node => node.textContent), 'Form');
  const formControls = await page.$$('#settings-manifest input, #settings-manifest select');
  for (const control of formControls) {
    const tag = await control.evaluate(node => node.tagName);
    const type = await control.evaluate(node => node.type);
    if (tag === 'SELECT') {
      const values = await control.$$eval('option', options => options.map(option => option.value));
      await control.select(values.at(-1));
    } else if (type === 'checkbox') {
      await control.click();
    } else {
      await control.focus();
      await page.keyboard.press('End');
      await page.keyboard.type('-qa');
    }
  }
  await page.$$eval('#settings-manifest button', buttons => buttons.find(button => button.textContent.includes('Add field'))?.click());
  await page.$$eval('#settings-manifest button', buttons => buttons.find(button => button.textContent.includes('Add alias'))?.click());
  const geometry = await page.$eval('#settings-manifest', node => ({ scrollWidth: node.scrollWidth, clientWidth: node.clientWidth }));
  assert(geometry.scrollWidth <= geometry.clientWidth, 'Manifest form must not overflow at phone width');
  assert.equal(await page.$$eval('#settings-manifest button[aria-label="Remove"]', buttons => buttons.length), 4, 'Added rows expose accessible remove controls');
  const screenshot = path.join(os.tmpdir(), 'settings-manifest-390-dark.png');
  await page.$eval('#settings-manifest', node => node.scrollIntoView());
  await page.screenshot({ path: screenshot, fullPage: true });
  // A fresh visit drops the edits above, then one controlled change exercises the write path the
  // manifest form now shares with a remote workspace: the editor follows write access, not locality.
  await page.setViewport({ width: 1440, height: 1000 });
  await visit('/settings');
  await page.click('#settings-manifest input[type="text"]', { clickCount: 3 });
  await page.keyboard.type('Manifest QA Saved');
  await page.$$eval('#settings-manifest button', buttons => buttons.find(button => button.textContent.includes('Save & Commit'))?.click());
  await page.waitForFunction(() => document.querySelector('#settings-manifest')?.textContent?.includes('Workspace configuration saved and committed.'), { timeout: 15000 });
  assert.equal(git('log', '-1', '--pretty=%s').toString().trim(), 'chore(workspace): update configuration');
  assert(fs.readFileSync(path.join(root, 'notes/.github-notes.yaml'), 'utf8').includes('Manifest QA Saved'), 'Saving must reach the manifest on disk');
  assert.deepEqual(errors, []);
  console.log(`PASS manifest modes, every field type, phone geometry and a committed save; screenshot: ${screenshot}`);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
}

// Two repositories: Settings opened from a notebook of the notebook repository edits that repository's manifest,
// while the header keeps the default repository's title (decision C10).
{
  const home = createQaWorkspace('github-notes-manifest-home-');
  home.write('.mygitnotes.yaml', 'schema_version: 3\nworkspace:\n  title: Home QA\n  default_notebook: life\nnotebooks:\n  - id: life\n    title: Life\n    root: notes/life\n  - id: campaign\n    title: Campaign log\n    root: notes/campaign\n    source: { type: github, repository: demo/campaign, branch: main }\n');
  home.write('notes/life/home.md', '# Home note\n');
  home.commitFixture();
  const campaign = createQaWorkspace('github-notes-manifest-campaign-');
  campaign.write('.mygitnotes.yaml', 'schema_version: 3\nworkspace:\n  title: Campaign QA\n  default_notebook: campaign\nnotebooks:\n  - id: campaign\n    title: Campaign log\n    root: notes/campaign\n');
  campaign.write('notes/campaign/session.md', '# Session\n');
  campaign.commitFixture();
  const serverConfig = path.join(home.root, '..', `${path.basename(home.root)}.server.yaml`);
  fs.writeFileSync(serverConfig, `repositories:\n  - type: github\n    repository: demo/campaign\n    path: ${campaign.root}\n`);
  process.env.MYGITNOTES_SERVER_CONFIG = serverConfig;
  const { server, base } = await startQaServer(home.root);
  const browser = await launchQaBrowser(require);
  const page = await browser.newPage();
  const errors = collectPageErrors(page);
  try {
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(base, { waitUntil: 'networkidle2' });
    await page.evaluate(() => localStorage.setItem('github-notes:language', 'en'));
    await page.goto(`${base}/notebooks/campaign~campaign`, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => document.querySelector('header h1')?.textContent === 'Campaign QA');
    // Settings is reached the way a person does, from the navigation, so the app carries the current notebook.
    await page.click('nav[aria-label="Main navigation"] button[aria-label="Settings"]');
    await page.waitForSelector('#settings-manifest [role="combobox"]');
    assert.equal(new URL(page.url()).searchParams.get('notebook'), 'campaign~campaign');
    assert.equal(await page.$eval('#settings-manifest [role="combobox"]', node => node.textContent), 'Campaign QA · demo/campaign', "Settings opens on the current notebook's repository");
    assert.equal(await page.$eval('#settings-manifest input[type="text"]', input => input.value), 'Campaign QA');
    assert.equal(await page.$eval('header h1', node => node.textContent), 'Home QA', 'The header shows the default repository on Settings');
    await page.goto(`${base}/settings`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('#settings-manifest [role="combobox"]');
    assert.equal(await page.$eval('#settings-manifest [role="combobox"]', node => node.textContent.split(' · ')[0]), 'Home QA', 'Settings without a notebook opens on the default repository');
    assert.deepEqual(errors, []);
    console.log("PASS Settings opens the manifest of the current notebook's repository, and of the default repository without one");
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
    delete process.env.MYGITNOTES_SERVER_CONFIG;
    for (const root of [home.root, campaign.root]) fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(serverConfig, { force: true });
  }
}
