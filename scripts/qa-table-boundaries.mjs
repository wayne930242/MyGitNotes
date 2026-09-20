import assert from 'node:assert/strict';

const table = '| A | B |\n| - | - |\n| a | b |';
const before = '# Root Note\n\nBefore the table.\n';
const after = '\nAfter the table.';
const initial = before + '\n' + table + '\n' + after;
const above = before + 'new line\n' + table + '\n' + after;
const below = before + '\n' + table + '\n\nnew line' + after;
// A table at a document edge has no line beyond it, so the boundary key holds the caret in place.
const atStart = table + '\n' + after;
const atEnd = before + '\n' + table;
export const tableBoundaryCases = [{ name: 'type-below', at: 'below', text: 'new line', expected: below }, { name: 'type-above', at: 'above', text: 'new line', expected: above }, { name: 'backspace-paragraph', at: 'after', key: 'Backspace', expected: initial }, { name: 'backspace-blank', at: 'below', key: 'Backspace', expected: initial }, { name: 'delete-paragraph', at: 'before', key: 'Delete', expected: initial }, { name: 'delete-blank', at: 'above', key: 'Delete', expected: initial }, { name: 'delete-below-blank', at: 'below', key: 'Delete', expected: initial }, { name: 'backspace-above-blank', at: 'above', key: 'Backspace', expected: initial }, { name: 'backspace-then-type', at: 'after', key: 'Backspace', text: 'new line', expected: above }, { name: 'delete-then-type', at: 'before', key: 'Delete', text: 'new line', expected: below }, { name: 'enter-paragraph', at: 'after', key: 'Enter', expected: before + '\n' + table + '\n\n' + after }, { name: 'table-at-start', at: 'after', key: 'Backspace', initial: atStart, expected: atStart }, { name: 'table-at-end', at: 'before', key: 'Delete', initial: atEnd, expected: atEnd }].map(test => ({ initial, ...test }));

export async function verifyTableBoundaries(page, base, click) {
  for (const test of tableBoundaryCases) {
    // Each undo run uses a fresh editor: switching to Source remounts CodeMirror.
    for (const undo of [false, true]) {
      await page.goto(`${base}/notebooks/example/notes/edge-${test.name}-${undo}.md`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('.live-md-table');
      const point = await page.evaluate(at => {
        const table = document.querySelector('.live-md-table');
        const line = at === 'above' ? table.previousElementSibling : at === 'below' ? table.nextElementSibling : [...document.querySelectorAll('.cm-line')].find(line => line.textContent === (at === 'before' ? 'Before the table.' : 'After the table.'));
        if (!line?.matches('.cm-line')) throw Error(`Missing boundary line: ${at}`);
        const rect = line.getBoundingClientRect();
        return { x: rect.left + 2, y: rect.top + rect.height / 2 };
      }, test.at);
      await page.mouse.click(point.x, point.y);
      if (test.at === 'after') await page.keyboard.press('Home');
      if (test.at === 'before') await page.keyboard.press('End');
      if (test.key) await page.keyboard.press(test.key);
      if (test.text) await page.keyboard.type(test.text);
      const hasEdit = test.expected !== test.initial;
      if (undo && hasEdit) {
        const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
        await page.keyboard.down(modifier);
        await page.keyboard.press('KeyZ');
        await page.keyboard.up(modifier);
      }
      assert.equal(await page.$$eval('.live-md-table', tables => tables.length), 1, `${test.name}: table count`);
      assert.deepEqual(await page.$eval('.live-md-table table', table => [...table.rows].map(row => [...row.cells].map(cell => cell.textContent))), [['A', 'B'], ['a', 'b']], `${test.name}: table content`);
      await click('Source');
      const source = await page.$eval('textarea[aria-label="Note content"]', textarea => textarea.value);
      assert.equal(source, undo ? test.initial : test.expected, `${test.name}${undo ? ' single undo' : ''}: Source text`);
    }
    console.log(`PASS table boundary: ${test.name}; exact Source text${test.expected !== test.initial ? ' and single undo' : ' (caret movement only)'}`);
  }
}
