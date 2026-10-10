import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { collectPageErrors, createQaWorkspace, launchQaBrowser, product, qaRequire, startQaServer } from './lib/qa-harness.mjs';

// Book arrangement against the built app and a disposable local workspace: a legacy `stack` file opens as Book without being
// written, the contents follow scrolling and jump, the drawer serves a narrow compilation, and a section edits in place.
const require = qaRequire();
const { SUPPORTED_SCHEMA_VERSION, WORKSPACE_CONFIG_FILENAME } = await import(`${product}/packages/core/dist/index.js`);
const { root, write, git, commitFixture } = createQaWorkspace('mygitnotes-book-qa-');
write(WORKSPACE_CONFIG_FILENAME, `schema_version: ${SUPPORTED_SCHEMA_VERSION}\nworkspace:\n  title: Book QA\n  default_notebook: a\nnotebooks:\n  - id: a\n    title: Research\n    root: notes/a\n`);
const two = n => String(n).padStart(2, '0');
const chapters = Array.from({ length: 12 }, (_, index) => index + 1);
for (const n of chapters) {
  const paragraphs = Array.from({ length: 9 }, (_, k) => `Paragraph ${k + 1} of chapter ${two(n)}. The quick brown fox jumps over the lazy dog while the book keeps scrolling.`).join('\n\n');
  write(`notes/a/chapter-${two(n)}.md`, `---\ntitle: Chapter ${two(n)}\n---\n# Heading ${two(n)}\n\n${paragraphs}\n`);
}
write('notes/a/sub/sub-one.md', '---\ntitle: Sub one\n---\n# Sub one\n\nFirst note of the folder.\n');
write('notes/a/sub/sub-two.md', '---\ntitle: Sub two\n---\n# Sub two\n\nSecond note of the folder.\n');
const compilationFile = 'notes/a/reading.compilation.yml';
const legacy = `version: 1\nid: reading\ntitle: Reading\narrangement: stack\nitems:\n${chapters.map(n => `  - { id: c${two(n)}, kind: note, path: notes/a/chapter-${two(n)}.md }`).join('\n')}\n  - { id: sub, kind: folder, path: notes/a/sub }\n`;
write(compilationFile, legacy);
commitFixture('Book QA');

const { server, base } = await startQaServer(root);
const browser = await launchQaBrowser(require);
const shots = path.join(product, 'artifacts/qa');
fs.mkdirSync(shots, { recursive: true });
const page = await browser.newPage();
const errors = collectPageErrors(page);
await page.evaluateOnNewDocument(() => localStorage.setItem('github-notes:language', 'en'));
await page.setViewport({ width: 1440, height: 1000 });

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const waitFile = async (file, text) => {
  for (let i = 0; i < 100; i++) {
    if (read(file).includes(text)) return;
    await pause(100);
  }
  throw new Error(`Saved content missing from ${file}: ${text}`);
};
const BODY = '.compilation-book';
const anchor = id => `[data-book-anchor="chapter:${id}"]`;
const section = n => `.compilation-book > .compilation-book-section:nth-child(${n})`;
const open = async () => {
  await page.goto(`${base}/notebooks/a/notes/reading.compilation.yml`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.compilation-book-view', { timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll('.compilation-book [data-book-anchor]').length >= 15);
};
const current = () => page.$$eval('.compilation-book-layout > .compilation-book-contents button[aria-current="location"]', buttons => buttons.map(button => button.textContent.trim()));
const entries = () => page.$$eval('.compilation-book-layout > .compilation-book-contents button', buttons => buttons.map(button => button.textContent.trim()));
/** The heading's top edge relative to the top of the book body. */
const headingTop = selector => page.$eval(BODY, (body, selector) => body.querySelector(selector).getBoundingClientRect().top - body.getBoundingClientRect().top, selector);
const scrollToHeading = selector =>
  page.$eval(BODY, (body, selector) => {
    body.scrollTop += body.querySelector(selector).getBoundingClientRect().top - body.getBoundingClientRect().top;
  }, selector);
const dialogOpen = () => page.$('[role="dialog"][aria-label="Compilation"]').then(Boolean);
const editorFocused = () => Boolean(document.activeElement?.closest('[data-editing] .cm-content, [data-editing] textarea'));
const shot = name => page.screenshot({ path: path.join(shots, `compilation-book-${name}.png`) });

try {
  // S2: a stack file opens as Book and is left as it is.
  await open();
  assert.equal(await page.$eval('.compilation-view', view => view.dataset.arrangement), 'book', 'A stack file did not open as Book');
  assert.equal(read(compilationFile), legacy, 'Opening a stack file wrote it');
  assert.equal(git('status', '--porcelain').toString(), '', 'Opening a stack file left the workspace dirty');
  console.log('PASS a stack compilation opens as Book without writing the file');

  // B2, B5: contents beside the book, with the folder's notes beneath it.
  const names = await entries();
  assert.deepEqual(names, [...chapters.map(n => `Chapter ${two(n)}`), 'sub', 'Sub one', 'Sub two']);
  assert.equal(await page.$eval('.compilation-book-layout > .compilation-book-contents', nav => nav.getAttribute('aria-label')), 'Contents');
  assert.equal(await page.$eval('.compilation-book-bar', bar => getComputedStyle(bar).display), 'none', 'The Contents button shows beside a wide contents list');
  await shot('reading');

  // B6, B7, B11: highlight follows scrolling, a click jumps, the page itself never scrolls.
  assert.deepEqual(await current(), ['Chapter 01']);
  await scrollToHeading(anchor('c06'));
  await page.waitForFunction(() => document.querySelector('.compilation-book-layout > .compilation-book-contents button[aria-current="location"]')?.textContent.trim() === 'Chapter 06');
  await page.click('.compilation-book-layout > .compilation-book-contents li:nth-child(9) button');
  await page.waitForFunction(
    selector => {
      const body = document.querySelector('.compilation-book');
      return Math.abs(body.querySelector(selector).getBoundingClientRect().top - body.getBoundingClientRect().top) < 12;
    },
    {},
    anchor('c09'),
  );
  assert.deepEqual(await current(), ['Chapter 09']);
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.bookAnchor), 'chapter:c09', 'Heading did not take focus');
  assert.ok(new URL(page.url()).hash === '', 'A jump changed the URL');
  assert.equal(await page.evaluate(() => document.scrollingElement.scrollTop), 0, 'The page scrolled');
  await page.$eval(BODY, body => {
    body.scrollTop = body.scrollHeight;
  });
  await page.waitForFunction(() => document.querySelector('.compilation-book-layout > .compilation-book-contents button[aria-current="location"]')?.textContent.trim() === 'Sub two');
  console.log('PASS contents highlight follows scrolling, jumps to a heading and ends on the last entry');

  // E1, E5, E6: click the body of chapter 3, type, then Edit chapter 5; chapter 3 is saved on disk and chapter 5 keeps its heading in place.
  await scrollToHeading(anchor('c03'));
  await page.click(`${section(3)} .compilation-inline-reading p`);
  await page.waitForSelector(`${section(3)}[data-editing] .cm-content`);
  await page.waitForFunction(editorFocused);
  await page.keyboard.type('TYPED-IN-CHAPTER-THREE ');
  // Blank lines make the editor much taller than the section reads once saved, so leaving it moves everything below it.
  for (let line = 0; line < 30; line++) await page.keyboard.press('Enter');
  await pause(500);
  await scrollToHeading(anchor('c05'));
  await pause(300);
  const before = await headingTop(anchor('c05'));
  // A script click would scroll the button into view first; this one leaves the scroll position to the app.
  await page.$eval('button[aria-label="Edit Chapter 05"]', button => button.click());
  await page.waitForSelector(`${section(5)}[data-editing] .cm-content`);
  await page.waitForFunction(selector => !document.querySelector(selector).hasAttribute('data-editing'), {}, section(3));
  await waitFile('notes/a/chapter-03.md', 'TYPED-IN-CHAPTER-THREE');
  await pause(300);
  await shot('editing');
  const after = await headingTop(anchor('c05'));
  assert.ok(Math.abs(after - before) <= 2, `Chapter 5 heading moved from ${before} to ${after} when it began editing`);
  assert.equal(await page.$$eval('[data-editing]', editing => editing.length), 1, 'More than one section edits');
  assert.ok((await page.$eval(`${section(3)} .compilation-inline-reading`, element => element.textContent)).includes('TYPED-IN-CHAPTER-THREE'), 'Chapter 3 does not read with the saved content');
  console.log('PASS click-edit a section, switch to another, the first is saved and the heading keeps its place');

  // E3: the editor takes its content's height in both modes, so the book scrolls as one document.
  const grown = selector => page.$eval(`${section(5)} ${selector}`, element => ({ inner: element.scrollHeight - element.clientHeight, height: element.getBoundingClientRect().height, width: element.getBoundingClientRect().width }));
  const sectionWidth = await page.$eval(section(5), element => element.getBoundingClientRect().width);
  const live = await grown('.cm-scroller');
  assert.ok(live.inner <= 1 && live.height > 400, `The live editor scrolls inside the section: ${JSON.stringify(live)}`);
  assert.ok((await grown('.note-editor-body')).width >= sectionWidth - 4, 'The live editor does not fill the section width');
  await page.$eval(`${section(5)} [data-mode-toggle]`, button => button.click());
  await page.waitForSelector(`${section(5)} textarea`);
  await pause(300);
  const source = await grown('textarea');
  assert.ok(source.inner <= 1 && source.height > 400, `The source editor scrolls inside the section: ${JSON.stringify(source)}`);
  assert.ok(source.width >= sectionWidth - 80, `The source editor is narrower than the section: ${JSON.stringify(source)}`);
  await page.focus(`${section(5)} textarea`);
  await page.keyboard.type('x\n\n\n');
  await pause(200);
  const typed = await grown('textarea');
  assert.ok(typed.inner <= 1 && typed.height > source.height, `The source editor did not grow with its text: ${JSON.stringify([source, typed])}`);
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await shot('editing-source');
  await page.$eval(`${section(5)} [data-mode-toggle]`, button => button.click());
  await page.waitForSelector(`${section(5)} .cm-content`);
  console.log('PASS the section editor grows with its content in live and source mode');

  // E4: the title opens the note in zoom on the same editing session, and closing zoom returns the editor to the section.
  await page.focus(`${section(5)} .cm-content`);
  await page.keyboard.type('UNSAVED-SESSION ');
  await page.click(`${section(5)} .compilation-book-title`);
  await page.waitForSelector('[role="dialog"][aria-label="Note editor"] .cm-content');
  const zoomText = await page.$eval('[role="dialog"][aria-label="Note editor"] .cm-content', element => element.textContent);
  assert.ok(zoomText.includes('UNSAVED-SESSION'), `Zoom does not share the editing session: ${zoomText.slice(0, 120)}`);
  assert.ok((await page.$eval(`${section(5)}`, element => element.textContent)).includes('This note is open in zoom.'), 'The section does not say the note is in zoom');
  await page.click('button[aria-label="Close note"]');
  await page.waitForSelector(`${section(5)}[data-editing] .cm-content`);
  assert.ok((await page.$eval(`${section(5)} .cm-content`, element => element.textContent)).includes('UNSAVED-SESSION'), 'The section lost its text after zoom');
  console.log('PASS zoom borrows the section editor and gives it back');

  // K2: Escape leaves the section first, then the compilation.
  await page.click(`${section(5)} .cm-content`);
  await page.keyboard.press('Escape');
  await page.waitForFunction(selector => !document.querySelector(selector).hasAttribute('data-editing'), {}, section(5));
  assert.ok(await dialogOpen(), 'The first Escape closed the compilation');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Edit Chapter 05', 'Focus is not on the Edit button');
  await waitFile('notes/a/chapter-05.md', 'UNSAVED-SESSION');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('[role="dialog"][aria-label="Compilation"]'));
  console.log('PASS Escape leaves the section, then the compilation');

  // B8: a narrow compilation lists its contents in a drawer.
  await page.setViewport({ width: 390, height: 844 });
  await open();
  assert.equal(await page.$eval('.compilation-book-layout > .compilation-book-contents', nav => getComputedStyle(nav).display), 'none', 'The contents list stayed beside a narrow book');
  assert.notEqual(await page.$eval('.compilation-book-bar', bar => getComputedStyle(bar).display), 'none', 'No Contents button in a narrow book');
  assert.ok(await page.$eval(BODY, body => body.getBoundingClientRect().width <= window.innerWidth), 'The book is wider than the screen');
  await page.click('.compilation-book-contents-button');
  await page.waitForSelector('[role="dialog"][aria-label="Contents"]');
  await shot('drawer-390');
  await page.evaluate(() => [...document.querySelectorAll('[role="dialog"][aria-label="Contents"] button')].find(button => button.textContent.trim() === 'Chapter 04').click());
  await page.waitForFunction(() => !document.querySelector('[role="dialog"][aria-label="Contents"]'));
  await page.waitForFunction(
    selector => {
      const body = document.querySelector('.compilation-book');
      return Math.abs(body.querySelector(selector).getBoundingClientRect().top - body.getBoundingClientRect().top) < 12;
    },
    {},
    anchor('c04'),
  );
  await page.click('.compilation-book-contents-button');
  await page.waitForSelector('[role="dialog"][aria-label="Contents"]');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('[role="dialog"][aria-label="Contents"]'));
  assert.ok(await dialogOpen(), 'Escape in the drawer closed the compilation');
  assert.equal(await page.evaluate(() => document.activeElement?.className.includes('compilation-book-contents-button')), true, 'Focus did not return to the Contents button');
  // 719 and 720: the drawer follows the compilation's own width (not the screen's), so the frame's padding is measured first.
  const bookWidth = () => page.$eval('.compilation-book-view', element => element.getBoundingClientRect().width);
  const frame = 390 - await bookWidth();
  for (const [width, drawer] of [[719, true], [720, false]]) {
    await page.setViewport({ width: width + Math.round(frame), height: 844 });
    await page.waitForFunction(expected => Math.round(document.querySelector('.compilation-book-view').getBoundingClientRect().width) === expected, {}, width);
    assert.equal(await page.$eval('.compilation-book-contents-button', button => getComputedStyle(button.parentElement).display !== 'none'), drawer, `Contents button at ${width}px`);
    assert.equal(await page.$eval('.compilation-book-layout > .compilation-book-contents', nav => getComputedStyle(nav).display !== 'none'), !drawer, `Contents list at ${width}px`);
  }
  console.log('PASS narrow contents drawer opens, jumps, closes and follows the 720px width');

  // S3: an arrangement change writes `book`, never `stack`.
  await page.setViewport({ width: 1440, height: 1000 });
  await open();
  await page.click('.compilation-book-view button[aria-label="Small"]');
  await waitFile(compilationFile, 'arrangement: lane');
  await page.waitForSelector('.compilation-view[data-arrangement="small"]');
  await page.click('.compilation-view button[aria-label="Book"]');
  await waitFile(compilationFile, 'arrangement: book');
  assert.ok(!read(compilationFile).includes('stack'), 'The file still names stack');
  console.log('PASS changing the arrangement writes book');

  assert.deepEqual(errors, [], `Page errors: ${errors.join('; ')}`);
} catch (error) {
  await shot('failure').catch(() => {});
  console.error(errors);
  throw error;
} finally {
  await browser.close();
  server.close();
}
