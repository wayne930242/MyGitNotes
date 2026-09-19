import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { resolveQaChromePath } from './qa-chrome.mjs';
const product = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(`${product}/apps/web/package.json`);
const puppeteer = require('puppeteer-core');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'github-notes-browser-'));
const write = (p, s) => {
  fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
  fs.writeFileSync(path.join(root, p), s);
};
const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
write('notes/.github-notes.yaml', 'schema_version: 1\nworkspace:\n  title: Folder QA\n  default_notebook: example\nnotebooks:\n  - id: example\n    title: Example\n    root: notes/example\n');
write('notes/example/root.md', '---\ntitle: Root Note\ntags:\n  - qa\nstatus: active\n---\n\n# Root Note\n\nParagraph **bold** and *italic*.\n\n> Quoted first line.\n> Quoted second line.\nLazy continuation without a marker.\n>\n> > Nested quote line.\n\nhttps://youtu.be/dQw4w9WgXcQ?t=45\n\n- [ ] Task\n\n| A | B |\n| - | - |\n| a | b |\n\n![pixel](assets/pixel.png)\n\n' + Array.from({ length: 160 }, (_, index) => `Long reading paragraph ${index + 1}.`).join('\n\n') + '\n');
write('notes/example/plain.md', '# Plain Note\n\nNo frontmatter here.\n');
write('notes/example/projects/_dir.yml', 'title: Projects\norder: -1\n');
write('notes/example/projects/deep/_dir.yml', 'title: Deep work\n');
write('notes/example/projects/deep/nested.md', '# Nested Note\n');
write('notes/example/assets/pixel.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'));
write('notes/example/reload.md', '---\ntitle: Reload\n---\n# Reload\n\nOriginal line.\n');
git('init', '-b', 'main');
git('config', 'user.name', 'Browser QA');
git('config', 'user.email', 'qa@example.com');
git('add', '.');
git('commit', '-m', 'fixture');
process.env.MYGITNOTES_SOURCE = 'local';
process.env.MYGITNOTES_LOCAL_PATH = root;
delete process.env.VERCEL;
delete process.env.APP_URL;
const { createApp } = await import(`${product}/apps/local-server/dist/app.js`);
const server = createServer(createApp(product));
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: resolveQaChromePath(), headless: true, pipe: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
// CodeMirror binds Undo to Mod-z, which is Command on macOS.
const undoKey = process.platform === 'darwin' ? 'Meta' : 'Control';
const click = async text => {
  const ok = await page.evaluate(text => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const b = buttons.find(b => b.textContent.trim() === text) ?? buttons.find(b => b.getAttribute('aria-label') === text);
    b?.click();
    return !!b;
  }, text);
  if (!ok) throw Error(`Missing button: ${text}`);
};
// The plain Source-mode <textarea> has no custom keymap (unlike CodeMirror's .cm-content, which binds
// Mod-End itself), and neither Control+End nor Meta+Down reliably move a real Chrome textarea's caret
// via CDP-synthesized key events here, leaving it at position 0 and causing typed text to be prepended
// instead of appended. Set the caret directly instead of relying on a navigation shortcut.
const gotoTextareaEnd = () =>
  page.$eval('textarea[aria-label="Note content"]', e => {
    e.selectionStart = e.selectionEnd = e.value.length;
  });
const dispatchFocus = () =>
  page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
// Local-mode autosave (hardcoded on) commits dirty content to disk ~750ms after the last keystroke;
// once it lands, content===baseNote again and a later external change is adopted silently, never shown
// as a merge. The 60s-throttled remote check can only ever observe a genuine local-vs-remote merge while
// content is still dirty, so this nudges the textarea (add+remove a harmless character) faster than the
// 750ms debounce to keep it dirty until the periodic check actually runs and merges the concurrent edits.
const waitForMergedNoticeWhileEditing = async (timeoutMs = 75000, mergedText = 'Remote changes merged', conflictText = 'Remote changes conflict') => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await page.evaluate((mergedText, conflictText) => ({ merged: document.body.innerText.includes(mergedText), conflict: document.body.innerText.includes(conflictText) }), mergedText, conflictText);
    if (state.merged) return;
    if (state.conflict) throw Error('Editor reached a conflict state instead of a clean merge');
    await page.keyboard.type(' ');
    await page.keyboard.press('Backspace');
    await dispatchFocus();
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  const diag = await page.evaluate(() => ({ text: document.body.innerText.slice(0, 800), count: document.querySelectorAll('textarea[aria-label="Note content"]').length, values: Array.from(document.querySelectorAll('textarea[aria-label="Note content"]')).map(e => e.value) }));
  throw Error(`Merged notice did not appear within ${timeoutMs}ms: ${JSON.stringify(diag)}`);
};
try {
  await page.goto(base + '/notebooks/example/notes/root.md', { waitUntil: 'networkidle0' });
  await page.waitForSelector('.cm-content');
  await page.waitForSelector('.note-youtube-embed');
  const defaultMode = await page.$eval('.note-youtube-embed', embed => embed.dataset.youtubeMode);
  if (defaultMode !== 'thumbnail') throw Error(`YouTube did not default to thumbnail: ${defaultMode}`);
  await page.evaluate(() => {
    window.__youtubeCopied = '';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async text => {
          window.__youtubeCopied = text;
        },
      },
    });
  });
  await page.click('.note-youtube-embed [data-youtube-copy]');
  await page.waitForFunction(() => document.querySelector('.note-youtube-embed [data-youtube-copy]')?.dataset.copyState === 'copied');
  if (await page.evaluate(() => window.__youtubeCopied) !== 'https://youtu.be/dQw4w9WgXcQ?t=45') throw Error('YouTube Copy did not preserve the source URL');
  const geometry = async mode => {
    await page.click(`[data-youtube-mode-option="${mode}"]`);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve())));
    return page.evaluate(() => {
      const embed = document.querySelector('.note-youtube-embed').getBoundingClientRect();
      const line = [...document.querySelectorAll('.cm-line')].find(line => line.textContent.includes('Paragraph'));
      const range = document.createRange();
      range.setStart(line.firstChild, 0);
      range.setEnd(line.firstChild, 1);
      const glyph = range.getBoundingClientRect();
      const lineBox = line.getBoundingClientRect();
      const style = getComputedStyle(line);
      return { left: embed.left, right: embed.right, width: embed.width, glyphLeft: glyph.left, columnRight: lineBox.right - parseFloat(style.paddingRight) };
    });
  };
  const medium = await geometry('medium');
  if (Math.abs(medium.left - medium.glyphLeft) > 1 || medium.width > 641) throw Error(`YouTube medium alignment failed: ${JSON.stringify(medium)}`);
  const theater = await geometry('theater');
  if (Math.abs(theater.left - theater.glyphLeft) > 1 || Math.abs(theater.right - theater.columnRight) > 1) throw Error(`YouTube theater alignment failed: ${JSON.stringify(theater)}`);
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.note-youtube-embed[data-youtube-mode="theater"]');
  await page.click('[data-youtube-mode-option="thumbnail"]');
  await page.click('.note-youtube-poster');
  await page.waitForSelector('.note-youtube-persistent-player iframe');
  // The note editor here is the zoom overlay (.note-overlay); the player must render above the note
  // it belongs to, not behind that overlay's own backdrop.
  const zoomTopmost = await page.evaluate(() => {
    const embed = document.querySelector('.note-youtube-embed');
    const box = embed.getBoundingClientRect();
    const el = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return { isPlayerIframe: el?.tagName === 'IFRAME' && el.classList.contains('note-youtube-iframe'), tag: el?.tagName, cls: el?.className };
  });
  if (!zoomTopmost.isPlayerIframe) throw Error(`YouTube player iframe is not the topmost element over its embed in the zoom overlay: ${JSON.stringify(zoomTopmost)}`);
  await page.evaluate(() => {
    window.__youtubeQaPlayer = document.querySelector('.note-youtube-persistent-player iframe');
    const scroller = document.querySelector('.cm-scroller');
    scroller.scrollTop = scroller.scrollHeight;
  });
  await page.waitForFunction(() => !document.querySelector('.note-youtube-embed'));
  if (!await page.evaluate(() => window.__youtubeQaPlayer?.isConnected && window.__youtubeQaPlayer === document.querySelector('.note-youtube-persistent-player iframe'))) throw Error('YouTube playback iframe was replaced when CodeMirror virtualized its widget');
  await page.focus('.cm-content');
  await page.keyboard.down('Control');
  await page.keyboard.press('End');
  await page.keyboard.up('Control');
  await page.keyboard.type(' playback continues');
  if (!await page.evaluate(() => window.__youtubeQaPlayer?.isConnected && window.__youtubeQaPlayer === document.querySelector('.note-youtube-persistent-player iframe'))) throw Error('Editing elsewhere replaced the persistent YouTube iframe');
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.cm-content');
  await page.waitForSelector('.note-youtube-embed');
  console.log('PASS YouTube modes: alignment, persistence, inline playback, and CodeMirror virtualization continuity');
  if (await page.$('[data-live-markdown] .cm-lineNumbers')) throw Error('Live preview line numbers are visible by default');
  if (await page.$eval('button[aria-label="Line Numbers"]', e => e.getAttribute('aria-pressed')) !== 'false') throw Error('Line Numbers toggle does not report unpressed while hidden');
  await click('Source');
  await page.waitForSelector('textarea[aria-label="Note content"]');
  if (await page.$('[data-source-line-numbers]')) throw Error('Source line numbers are visible by default');
  await click('Live Preview');
  await page.waitForSelector('.cm-content');
  const unpressedColor = await page.$eval('button[aria-label="Line Numbers"]', e => getComputedStyle(e).color);
  await click('Line Numbers');
  await page.waitForSelector('[data-live-markdown] .cm-lineNumbers .cm-gutterElement');
  if (await page.$eval('button[aria-label="Line Numbers"]', e => e.getAttribute('aria-pressed')) !== 'true') throw Error('Line Numbers toggle does not report pressed once shown');
  const pressedStyle = await page.$eval('button[aria-label="Line Numbers"]', e => {
    const style = getComputedStyle(e);
    return { color: style.color, weight: Number(style.fontWeight) };
  });
  if (pressedStyle.color === unpressedColor || pressedStyle.weight < 600) throw Error(`Line Numbers pressed state is not visually distinct: ${JSON.stringify({ unpressedColor, pressedStyle })}`);
  const liveLines = await page.$$eval('[data-live-markdown] .cm-lineNumbers .cm-gutterElement', nodes => nodes.map(node => node.textContent.trim()).filter(Boolean));
  if (!liveLines.includes('8')) throw Error(`Live preview did not show the real first body line 8: ${liveLines.slice(0, 4)}`);
  await page.evaluate(() => {
    window.__linePrompt = '';
    window.__linePromptWrites = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async text => {
          window.__linePrompt = text;
          window.__linePromptWrites.push(text);
        },
      },
    });
  });
  const liveGutterPoint = async number =>
    page.$$eval('[data-live-markdown] .cm-lineNumbers .cm-gutterElement', (nodes, number) => {
      const node = [...nodes].find(node => node.textContent.trim() === String(number));
      if (!node) throw Error(`Missing live gutter line ${number}`);
      const rect = node.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }, number);
  let from = await liveGutterPoint(8), to = await liveGutterPoint(10);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  if (!await page.$('[data-live-markdown] .cm-line-copy-selected')) throw Error('Live preview drag range is not highlighted');
  await page.mouse.up();
  await page.waitForFunction(() => window.__linePrompt === 'Regarding lines 8-10 of `notes/example/root.md`: ');
  await page.waitForSelector('[data-line-copy-feedback][data-state="copied"]');
  from = await liveGutterPoint(10);
  to = await liveGutterPoint(8);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForFunction(() => window.__linePrompt === 'Regarding lines 8-10 of `notes/example/root.md`: ');
  const liveBefore = await page.evaluate(() => ({ text: document.querySelector('.cm-content')?.textContent, selection: window.getSelection()?.toString() }));
  await page.evaluate(() => {
    window.__linePromptWrites = [];
  });
  const single = await liveGutterPoint(8);
  await page.mouse.click(single.x, single.y);
  await new Promise(resolve => setTimeout(resolve, 80));
  await page.mouse.click(single.x, single.y);
  await page.waitForFunction(() => window.__linePrompt === 'Regarding line 8 of `notes/example/root.md`: ');
  if (await page.evaluate(() => window.__linePromptWrites.length) !== 1) throw Error('Live preview double-click wrote to the clipboard more than once');
  const liveAfter = await page.evaluate(() => ({ text: document.querySelector('.cm-content')?.textContent, selection: window.getSelection()?.toString() }));
  if (JSON.stringify(liveAfter) !== JSON.stringify(liveBefore)) throw Error('Live preview gutter gestures changed document text or selection');
  const liveLineStyle = await page.evaluate(() => {
    const gutter = getComputedStyle(document.querySelector('[data-live-markdown] .cm-lineNumbers'));
    const content = getComputedStyle(document.querySelector('[data-live-markdown] .cm-content'));
    return { opacity: Number(gutter.opacity), gutterFont: parseFloat(gutter.fontSize), contentFont: parseFloat(content.fontSize) };
  });
  if (liveLineStyle.opacity >= 0.8 || liveLineStyle.gutterFont >= liveLineStyle.contentFont) throw Error('Live preview line numbers are not visually subdued');
  await page.waitForSelector('.live-md-heading');
  await page.waitForSelector('.live-md-rendered table');
  // The YouTube fixture makes the image fall outside CodeMirror's initial mounted viewport.
  // Reveal the preceding table before asserting the adjacent rendered image, then return home.
  await page.$eval('.live-md-rendered table', node => node.scrollIntoView({ block: 'start' }));
  await page.waitForSelector('.live-md-rendered img');
  await page.$eval('.cm-scroller', node => {
    node.scrollTop = 0;
  });
  await page.waitForFunction(() => [...document.querySelectorAll('[data-live-markdown] .cm-lineNumbers .cm-gutterElement')].some(node => node.textContent.trim() === '8'));
  await page.click('[data-live-markdown] .cm-line');
  await page.waitForFunction(() => {
    const node = document.querySelector('[data-live-markdown] .cm-activeLineGutter');
    const style = node && getComputedStyle(node);
    return node?.textContent.trim() === '7' && Number(style?.fontWeight) >= 600 && style?.transform !== 'none' && style?.transform !== 'matrix(1, 0, 0, 1, 0, 0)';
  });
  const liveActiveLine = await page.$eval('[data-live-markdown] .cm-activeLineGutter', node => {
    const style = getComputedStyle(node);
    return { text: node.textContent.trim(), weight: Number(style.fontWeight), transform: style.transform };
  });
  if (liveActiveLine.text !== '7' || liveActiveLine.weight < 600 || liveActiveLine.transform === 'none') throw Error(`Live preview active line number is not emphasized: ${JSON.stringify(liveActiveLine)}`);
  // The quote bar and its padding hang in the gutter so a blockquote's own text starts at the
  // same x as a plain paragraph's, with a readable indent step per nesting level.
  const quoteAlign = async () =>
    page.evaluate(() => {
      const firstX = el => {
        if (!el) return null;
        const r = document.createRange();
        const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = w.nextNode())) {
          if (n.textContent.trim()) {
            r.setStart(n, 0);
            r.setEnd(n, 1);
            const b = r.getBoundingClientRect();
            if (b.width || b.height) return b.left;
          }
        }
        return null;
      };
      const lines = Array.from(document.querySelectorAll('.cm-line'));
      const para = lines.find(l => l.textContent.includes('Paragraph') && !l.className.includes('live-md-quote'));
      const quote = lines.find(l => l.textContent.includes('Quoted first line'));
      const lazy = lines.find(l => l.textContent.includes('Lazy continuation'));
      const nested = lines.find(l => l.textContent.includes('Nested quote line'));
      return { para: firstX(para), quote: firstX(quote), lazy: firstX(lazy), nested: firstX(nested) };
    });
  let align = await quoteAlign();
  if (align.para == null || align.quote == null || align.lazy == null || align.nested == null) throw Error(`Blockquote alignment check could not find all lines: ${JSON.stringify(align)}`);
  if (Math.abs(align.para - align.quote) > 1 || Math.abs(align.para - align.lazy) > 1) throw Error(`Blockquote text does not align with paragraph text at 1440px: ${JSON.stringify(align)}`);
  if (align.nested - align.quote < 8) throw Error(`Nested blockquote lacks a readable indent step at 1440px: ${JSON.stringify(align)}`);
  // A depth-2 quote line carries two adjacent QuoteMark nodes; their revealed '> > ' source must
  // merge into one span while the cursor sits on that line, not render as two overlapping markers.
  const nestedBox = await page.evaluate(() => {
    const l = Array.from(document.querySelectorAll('.cm-line')).find(l => l.textContent.includes('Nested quote line'));
    const r = l.getBoundingClientRect();
    return { x: r.left + 5, y: r.top + r.height / 2 };
  });
  await page.mouse.click(nestedBox.x, nestedBox.y);
  const nestedReveal = await page.evaluate(() => {
    const line = Array.from(document.querySelectorAll('.cm-line')).find(l => l.textContent.includes('Nested quote line'));
    const reveals = Array.from(line?.querySelectorAll('.live-md-quote-mark-reveal') || []);
    return { count: reveals.length, text: reveals.map(r => r.textContent).join('|') };
  });
  if (nestedReveal.count !== 1 || nestedReveal.text !== '> > ') throw Error(`Nested blockquote marker reveal did not merge into one span: ${JSON.stringify(nestedReveal)}`);
  await page.keyboard.down('Control');
  await page.keyboard.press('Home');
  await page.keyboard.up('Control');
  if (await page.$eval('.cm-content', e => e.innerText.includes('**bold**'))) throw Error('Inactive bold markers visible');
  await page.click('input[aria-label="Toggle task"]');
  await click('Source');
  await page.waitForSelector('textarea[aria-label="Note content"]');
  const sourceLines = await page.$$eval('[data-source-line-numbers] [data-line-number]', nodes => nodes.map(node => node.textContent.trim()));
  const sourceLineCount = await page.$eval('textarea[aria-label="Note content"]', e => e.value.split('\n').length);
  if (sourceLines.length !== sourceLineCount || sourceLines[0] !== '7' || sourceLines.at(-1) !== String(sourceLineCount + 6)) throw Error('Source line numbers do not match the saved file');
  const sourceGutterPoint = async number =>
    page.$$eval('[data-source-line-numbers] [data-line-number]', (nodes, number) => {
      const node = [...nodes].find(node => node.textContent.trim() === String(number));
      if (!node) throw Error(`Missing source gutter line ${number}`);
      const rect = node.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }, number);
  const sourceBefore = await page.$eval('textarea[aria-label="Note content"]', e => ({ value: e.value, start: e.selectionStart, end: e.selectionEnd }));
  from = await sourceGutterPoint(8);
  to = await sourceGutterPoint(10);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  if (!await page.$('[data-source-line-numbers] [data-line-copy-selected="true"]')) throw Error('Source drag range is not highlighted');
  await page.mouse.up();
  await page.waitForFunction(() => window.__linePrompt === 'Regarding lines 8-10 of `notes/example/root.md`: ');
  await page.waitForSelector('[data-line-copy-feedback][data-state="copied"]');
  from = await sourceGutterPoint(10);
  to = await sourceGutterPoint(8);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForFunction(() => window.__linePrompt === 'Regarding lines 8-10 of `notes/example/root.md`: ');
  await page.evaluate(() => {
    window.__linePromptWrites = [];
  });
  const sourceSingle = await sourceGutterPoint(8);
  await page.mouse.click(sourceSingle.x, sourceSingle.y);
  await new Promise(resolve => setTimeout(resolve, 80));
  await page.mouse.click(sourceSingle.x, sourceSingle.y);
  await page.waitForFunction(() => window.__linePrompt === 'Regarding line 8 of `notes/example/root.md`: ');
  if (await page.evaluate(() => window.__linePromptWrites.length) !== 1) throw Error('Source double-click wrote to the clipboard more than once');
  const sourceAfter = await page.$eval('textarea[aria-label="Note content"]', e => ({ value: e.value, start: e.selectionStart, end: e.selectionEnd }));
  if (JSON.stringify(sourceAfter) !== JSON.stringify(sourceBefore)) throw Error('Source gutter gestures changed document text or selection');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          throw Error('Denied');
        },
      },
    });
  });
  await page.mouse.click(sourceSingle.x, sourceSingle.y);
  await new Promise(resolve => setTimeout(resolve, 80));
  await page.mouse.click(sourceSingle.x, sourceSingle.y);
  await page.waitForSelector('[data-line-copy-feedback][data-state="error"]');
  if (!await page.$eval('[data-line-copy-feedback]', node => node.textContent.includes('Could not copy'))) throw Error('Clipboard rejection did not show localized failure feedback');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async text => {
          window.__linePrompt = text;
          window.__linePromptWrites.push(text);
        },
      },
    });
  });
  await page.waitForFunction(() => document.querySelector('[data-source-line-numbers] [data-line-number]')?.textContent.trim() === '8');
  if (!fs.readFileSync(path.join(root, 'notes/example/root.md'), 'utf8').includes('\nupdated:')) throw Error('Autosave did not persist the metadata line that changed the real-line offset');
  const firstSourceLineBox = await page.$eval('textarea[aria-label="Note content"]', node => {
    const rect = node.getBoundingClientRect();
    return { x: rect.left + 20, y: rect.top + 10 };
  });
  await page.mouse.click(firstSourceLineBox.x, firstSourceLineBox.y);
  await page.waitForFunction(() => {
    const node = document.querySelector('[data-line-number][data-active-line="true"]');
    const style = node && getComputedStyle(node);
    return node?.textContent.trim() === '8' && Number(style?.fontWeight) >= 600 && style?.transform !== 'none' && style?.transform !== 'matrix(1, 0, 0, 1, 0, 0)';
  });
  const sourceLineStyle = await page.evaluate(() => {
    const gutter = getComputedStyle(document.querySelector('[data-source-line-numbers] > div'));
    const source = getComputedStyle(document.querySelector('textarea[aria-label="Note content"]'));
    return { gutterFont: parseFloat(gutter.fontSize), sourceFont: parseFloat(source.fontSize), gutterLineHeight: gutter.lineHeight, sourceLineHeight: source.lineHeight };
  });
  if (sourceLineStyle.gutterFont >= sourceLineStyle.sourceFont || sourceLineStyle.gutterLineHeight !== sourceLineStyle.sourceLineHeight) throw Error('Source line numbers are not subdued and aligned');
  fs.mkdirSync(path.join(product, 'artifacts/qa'), { recursive: true });
  await page.screenshot({ path: product + '/artifacts/qa/source-line-numbers.png', fullPage: true });
  const sourceScroll = await page.evaluate(async () => {
    const source = document.querySelector('textarea[aria-label="Note content"]');
    const frame = source.parentElement;
    frame.style.flex = 'none';
    frame.style.height = '100px';
    source.scrollTop = 120;
    source.dispatchEvent(new Event('scroll', { bubbles: true }));
    await new Promise(resolve => requestAnimationFrame(resolve));
    return { scrollTop: source.scrollTop, transform: document.querySelector('[data-source-line-numbers] > div').style.transform };
  });
  if (sourceScroll.scrollTop <= 0 || sourceScroll.transform !== `translateY(-${sourceScroll.scrollTop}px)`) throw Error('Source line numbers did not follow vertical scrolling');
  if (!await page.$eval('textarea[aria-label="Note content"]', e => e.value.includes('- [x] Task'))) throw Error('Task checkbox did not edit Markdown');
  await click('Live Preview');
  await page.waitForSelector('.cm-content');
  await page.focus('.cm-content');
  await page.keyboard.down('Control');
  await page.keyboard.press('Home');
  await page.keyboard.up('Control');
  await page.waitForFunction(() => [...document.querySelectorAll('.cm-line')].some(line => line.textContent.includes('Root Note')));
  await page.keyboard.down('Control');
  await page.keyboard.press('End');
  await page.keyboard.up('Control');
  await page.keyboard.press('Enter');
  await page.keyboard.type('繁體中文 live edit');
  // Toggling line numbers reconfigures a Compartment; it must not remount the view, so the caret stays put and typing continues in place.
  await click('Line Numbers');
  await page.waitForFunction(() => !document.querySelector('[data-live-markdown] .cm-lineNumbers'));
  await page.keyboard.type(' continued');
  if (!await page.$eval('.cm-content', e => e.textContent.includes('繁體中文 live edit continued'))) throw Error('Toggling line numbers off lost the caret position');
  await click('Line Numbers');
  await page.waitForSelector('[data-live-markdown] .cm-lineNumbers .cm-gutterElement');
  // CodeMirror's history groups nearby edits by time, not by what happened in between, so undo may
  // take a couple of presses to clear both typed segments; what matters is that it clears them at all.
  for (let attempt = 0; attempt < 4 && await page.$eval('.cm-content', e => e.textContent.includes('live edit')); attempt++) {
    await page.keyboard.down(undoKey);
    await page.keyboard.press('KeyZ');
    await page.keyboard.up(undoKey);
  }
  if (await page.$eval('.cm-content', e => e.textContent.includes('live edit'))) throw Error('Undo across a line-number toggle did not restore the earlier content');
  await click('Source');
  if (await page.$eval('textarea[aria-label="Note content"]', e => e.value.includes('live edit'))) throw Error('Undo failed');
  await click('Live Preview');
  await page.focus('.cm-content');
  await page.keyboard.down('Control');
  await page.keyboard.press('End');
  await page.keyboard.up('Control');
  await page.keyboard.type('繁體中文 live edit');
  await page.click('button[aria-label="Document tools"]');
  await page.click('.note-panel-tabs [role="tab"][aria-label="Insert image"]');
  await page.waitForSelector('button[aria-label="Open folder: assets"]');
  await page.click('button[aria-label="Open folder: assets"]');
  await page.waitForSelector('button[aria-label="Select file: pixel.png"]');
  await page.click('button[aria-label="Select file: pixel.png"]');
  await page.waitForSelector('.file-detail button.ui-button:not([disabled])');
  await click('Insert image');
  await page.waitForFunction(() => !document.querySelector('.note-document-panel[data-open="true"]'));
  await click('Source');
  const text = await page.$eval('textarea[aria-label="Note content"]', e => e.value);
  if (!text.includes('繁體中文 live edit') || !text.includes('/raw-assets/by-hash/')) throw Error('Live insertion lost content');
  await click('Live Preview');
  await page.waitForSelector('.live-md-rendered img');
  await page.screenshot({ path: product + '/artifacts/qa/live-markdown-editor.png', fullPage: true });
  await click('Line Numbers');
  await page.waitForFunction(() => !document.querySelector('[data-live-markdown] .cm-lineNumbers'));
  if (await page.$eval('button[aria-label="Line Numbers"]', e => e.getAttribute('aria-pressed')) !== 'false') throw Error('Line Numbers toggle does not report unpressed once hidden again');
  await click('Line Numbers');
  await page.waitForSelector('[data-live-markdown] .cm-lineNumbers .cm-gutterElement');
  await page.setViewport({ width: 390, height: 844 });
  await page.waitForFunction(() => document.querySelector('[data-markdown-editor]')?.clientWidth <= 390);
  const mobileLive = await page.$eval('[data-markdown-editor]', editor => ({ clientWidth: editor.clientWidth, scrollWidth: editor.scrollWidth, gutterWidth: document.querySelector('[data-live-markdown] .cm-gutters')?.getBoundingClientRect().width }));
  if (mobileLive.scrollWidth > mobileLive.clientWidth || !mobileLive.gutterWidth) throw Error('Live preview line numbers overflow the mobile editor');
  // A narrow-viewport media query resets .cm-line's own padding; the quote's padding must be
  // reasserted against it or the alignment and the nested indent step collapse back together.
  align = await quoteAlign();
  if (align.para == null || align.quote == null || align.lazy == null || align.nested == null) throw Error(`Blockquote alignment check could not find all lines at 390px: ${JSON.stringify(align)}`);
  if (Math.abs(align.para - align.quote) > 1 || Math.abs(align.para - align.lazy) > 1) throw Error(`Blockquote text does not align with paragraph text at 390px: ${JSON.stringify(align)}`);
  if (align.nested - align.quote < 8) throw Error(`Nested blockquote lacks a readable indent step at 390px: ${JSON.stringify(align)}`);
  if (mobileLive.scrollWidth > mobileLive.clientWidth) throw Error('Blockquote bar causes horizontal scroll at 390px');
  console.log('PASS blockquote alignment: text matches paragraph text at 1440px and 390px, with a readable nested indent step');
  await click('Source');
  await page.waitForSelector('[data-source-line-numbers]');
  const mobileSource = await page.$eval('[data-markdown-editor]', editor => ({ clientWidth: editor.clientWidth, scrollWidth: editor.scrollWidth, gutterWidth: document.querySelector('[data-source-line-numbers]')?.getBoundingClientRect().width, sourceWidth: document.querySelector('textarea[aria-label="Note content"]')?.getBoundingClientRect().width }));
  if (mobileSource.scrollWidth > mobileSource.clientWidth || !mobileSource.gutterWidth || mobileSource.gutterWidth > 60 || mobileSource.sourceWidth < 250) throw Error('Source line numbers crowd or overflow the mobile editor');
  await page.screenshot({ path: product + '/artifacts/qa/mobile-source-line-numbers.png', fullPage: true });
  await page.waitForFunction(() => document.body.innerText.includes('Uncommitted Changes'));
  if (errors.length) throw Error(errors.join('; '));
  console.log('PASS live Markdown: formatting, active syntax, images, tables, tasks, Unicode, undo and asset insertion');

  await page.goto(base + '/notebooks/example/notes/plain.md', { waitUntil: 'networkidle0' });
  await page.waitForSelector('.cm-content');
  if (!await page.$('[data-live-markdown] .cm-lineNumbers')) await click('Line Numbers');
  await page.waitForFunction(() => [...document.querySelectorAll('[data-live-markdown] .cm-lineNumbers .cm-gutterElement')].some(node => node.textContent.trim() === '1'));
  await click('Source');
  await page.waitForSelector('[data-source-line-numbers] [data-line-number]');
  if (await page.$eval('[data-source-line-numbers] [data-line-number]', node => node.textContent.trim()) !== '1') throw Error('A note without frontmatter does not start at line 1 in Source mode');
  console.log('PASS real line numbers: frontmatter offsets both editors and plain notes start at 1; range and single-line prompt copy work in both modes');

  // Local mode: an open note picks up an external file change through the same
  // remote-check machinery (onReadRemote) that remote mode already used.
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(base + '/notebooks/example/notes/reload.md', { waitUntil: 'networkidle0' });
  await click('Source');
  await page.waitForSelector('textarea[aria-label="Note content"]');
  await page.waitForFunction(() => document.querySelector('textarea[aria-label="Note content"]')?.value.includes('Original line.'));
  fs.writeFileSync(path.join(root, 'notes/example/reload.md'), '---\ntitle: Reload\n---\n# Reload\n\nChanged externally.\n');
  // Reopening remounts the editor, which runs an unthrottled check on mount.
  await page.goto(base + '/notebooks/example/notes/reload.md', { waitUntil: 'networkidle0' });
  await click('Source');
  await page.waitForSelector('textarea[aria-label="Note content"]');
  await page.waitForFunction(() => document.querySelector('textarea[aria-label="Note content"]')?.value.includes('Changed externally.'));
  console.log('PASS local reload: reopening an unedited note shows a file changed on disk');

  // The app's own autosave must never be mistaken for an external change on the next check.
  await page.focus('textarea[aria-label="Note content"]');
  await gotoTextareaEnd();
  await page.keyboard.type('\nAutosaved local edit.');
  await new Promise(resolve => setTimeout(resolve, 1200)); // clear the autosave debounce
  if (!fs.readFileSync(path.join(root, 'notes/example/reload.md'), 'utf8').includes('Autosaved local edit.')) throw Error('Autosave did not reach disk before the next remote check');
  await new Promise(resolve => setTimeout(resolve, 61000)); // clear the remote-check throttle on this mount
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await new Promise(resolve => setTimeout(resolve, 800));
  const afterOwnSave = await page.evaluate(() => ({ text: document.body.innerText, value: document.querySelector('textarea[aria-label="Note content"]')?.value }));
  if (afterOwnSave.text.includes('Remote changes merged')) throw Error('The app treated its own autosave as an external change');
  if (!afterOwnSave.value?.includes('Autosaved local edit.')) throw Error('Content changed unexpectedly after the remote check');
  console.log('PASS local reload: local autosave is never treated as an external change');

  // A merged notice must be dismissible, stay hidden until a new merge, and never reappear on a bare reload.
  // Disk edits below always touch a different line than the concurrent in-editor local edit, so each merge is clean rather than a conflict.
  // Each mount's own unthrottled check-on-mount fires at t=0, so the next opportunity is the ~60s periodic interval, not a manual dispatch:
  // waiting a fixed 61s before editing would let that interval fire its own (no-op) check first and re-arm the throttle for another 60s.
  // So the local+external edit below happens right after mount, well inside the first window, and waitForMergedNotice's own retries ride out the interval's natural tick.
  await page.goto(base + '/notebooks/example/notes/reload.md', { waitUntil: 'networkidle0' });
  await click('Source');
  await page.waitForSelector('textarea[aria-label="Note content"]');
  await page.waitForFunction(() => document.querySelector('textarea[aria-label="Note content"]')?.value.includes('Autosaved local edit.'));
  await page.focus('textarea[aria-label="Note content"]');
  await gotoTextareaEnd();
  await page.keyboard.type('\nDismiss-flow local edit.'); // appends a new line; disjoint from the external edit below, which only replaces an existing line
  fs.writeFileSync(path.join(root, 'notes/example/reload.md'), '---\ntitle: Reload\n---\n# Reload\n\nChanged externally (external edit before dismiss).\nAutosaved local edit.\n');
  await waitForMergedNoticeWhileEditing();
  if (!await page.$eval('textarea[aria-label="Note content"]', e => e.value.includes('external edit before dismiss') && e.value.includes('Dismiss-flow local edit.'))) throw Error('The merged draft is missing the local or external change');
  console.log('PASS dismiss: an external change while editing shows the translated merged notice');

  await page.click('button[aria-label="Dismiss notice"]');
  if (await page.evaluate(() => document.body.innerText.includes('Remote changes merged'))) throw Error('The notice stayed visible after dismissing it');
  console.log('PASS dismiss: dismissing the merged notice hides it');

  await page.goto(base + '/notebooks/example/notes/reload.md', { waitUntil: 'networkidle0' });
  await click('Source');
  await page.waitForSelector('textarea[aria-label="Note content"]');
  await new Promise(resolve => setTimeout(resolve, 500));
  if (await page.evaluate(() => document.body.innerText.includes('Remote changes merged'))) throw Error('Reopening the note without a new remote change brought the merged notice back');
  console.log('PASS reload: reopening an unchanged note does not resurrect a stale merged notice');

  // Same mount as the reload check above, so its own check-on-mount already claimed t=0; edit now, well inside its first window.
  await page.focus('textarea[aria-label="Note content"]');
  await gotoTextareaEnd();
  // Appends after the last line; the external edit below changes the *first* content line instead of the
  // last one, so the two edits stay on non-adjacent lines (an insertion right next to a changed line is an
  // ambiguous 3-way merge that legitimately conflicts, as opposed to a clean, disjoint merge).
  await page.keyboard.type('\nSecond dismiss-flow local edit.');
  fs.writeFileSync(path.join(root, 'notes/example/reload.md'), '---\ntitle: Reload\n---\n# Reload\n\nChanged externally, a second time (external edit before dismiss).\nAutosaved local edit.\n');
  await waitForMergedNoticeWhileEditing();
  console.log('PASS dismiss: a later, different merge shows the notice again after an earlier dismissal');

  // The merge/dismiss notices must be translated, not just the rest of the UI.
  await page.evaluate(() => localStorage.setItem('github-notes:language', 'zh-TW'));
  fs.writeFileSync(path.join(root, 'notes/example/reload.md'), '---\ntitle: Reload\n---\n# Reload\n\nChanged externally, a third time (external edit before dismiss).\nAutosaved local edit.\n');
  await page.goto(base + '/notebooks/example/notes/reload.md', { waitUntil: 'networkidle0' });
  await click('原始碼');
  await page.waitForSelector('textarea[aria-label="Note content"]');
  await page.waitForFunction(() => document.querySelector('textarea[aria-label="Note content"]')?.value.includes('Autosaved local edit.'));
  await page.focus('textarea[aria-label="Note content"]');
  await gotoTextareaEnd();
  await page.keyboard.type('\nZh-TW dismiss-flow local edit.');
  fs.writeFileSync(path.join(root, 'notes/example/reload.md'), '---\ntitle: Reload\n---\n# Reload\n\nChanged externally, a fourth time (external edit before dismiss).\nAutosaved local edit.\n');
  await waitForMergedNoticeWhileEditing(75000, '遠端變更已併入此草稿', '遠端變更與您的草稿衝突');
  console.log('PASS zh-TW: the merged notice is translated');

  await page.click('button[aria-label="關閉通知"]');
  if (await page.evaluate(() => document.body.innerText.includes('遠端變更已併入此草稿'))) throw Error('The zh-TW notice stayed visible after dismissing it');
  console.log('PASS zh-TW: dismissing the merged notice hides it');
} finally {
  await browser.close();
  await new Promise(r => server.close(r));
  fs.rmSync(root, { recursive: true, force: true });
}
