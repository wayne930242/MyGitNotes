import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { formatFiles, root } from './source-tools.mjs';

const webRequire = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { transformWithEsbuild } = await import(webRequire.resolve('vite'));
const directory = mkdtempSync(path.join(root, 'scripts/format-semantics-'));
afterAll(() => rmSync(directory, { recursive: true, force: true }));
const compile = async source => (await transformWithEsbuild(source, 'probe.tsx', { loader: 'tsx', jsx: 'automatic', minify: true })).code;

describe('source formatting semantics', () => {
  it.each(['ChangesTool.tsx', 'KanbanView.tsx', 'ScreenPage.tsx'])('matches stable file formatting in check mode: %s', name => {
    const file = path.join(directory, name);
    const source = readFileSync(path.join(root, 'apps/web/src/components', name), 'utf8');
    writeFileSync(file, source);
    expect(formatFiles([file]).status).toBe(0);
    const formatted = readFileSync(file, 'utf8');
    expect(formatFiles([file], true).status).toBe(0);
    expect(readFileSync(file, 'utf8')).toBe(formatted);
  });

  it('reports needed formatting without writing in check mode', () => {
    const file = path.join(directory, 'read-only.tsx');
    const source = 'export const view = <div>{title} </div>;\n';
    writeFileSync(file, source);
    expect(formatFiles([file], true).status).not.toBe(0);
    expect(readFileSync(file, 'utf8')).toBe(source);
    expect(formatFiles([file]).status).toBe(0);
    expect(formatFiles([file], true).status).toBe(0);
  });

  it('maintains import and export declaration order', () => {
    const file = path.join(directory, 'order.ts');
    const source = "import z from './z';\nimport a from './a';\nimport './z.css';\nimport './a.css';\nexport { z } from './z';\nexport { a } from './a';\nexport const values = [z, a];\n";
    writeFileSync(file, source);
    expect(formatFiles([file]).status).toBe(0);
    expect(readFileSync(file, 'utf8')).toBe(source);
  });

  it.each(['export const view = <section>{error && <p>{error}</p>}\n {loading ? <p>loading</p> : <article>{body}</article>}</section>;', 'export const view = <div>\n {items.map(render)}\n</div>;', 'export const view = <div>{title} </div>;', 'export const view = <div>{done} / {total}</div>;', 'export const view = <div> leading and trailing </div>;', 'export const view = <div>two  spaces {value}  end</div>;', 'export const view = <div>{a} {b}<span> child </span> tail </div>;', 'export const view = <div>\n  first line\n  second line {value}\n  / {total}\n</div>;', 'export const view = <div>中文 &amp; &#32; &#160; &#10; \\ text {value} </div>;', 'export const view = <div title="unchanged">\n <span>only</span>\n <span>elements</span>\n</div>;'])('preserves compiled JSX text and is idempotent: %s', async source => {
    const file = path.join(directory, 'probe.tsx');
    writeFileSync(file, source);
    expect(formatFiles([file]).status).toBe(0);
    const formatted = readFileSync(file, 'utf8');
    expect(await compile(formatted)).toBe(await compile(source));
    expect(formatFiles([file], true).status).toBe(0);
    expect(readFileSync(file, 'utf8')).toBe(formatted);
    expect(formatFiles([file]).status).toBe(0);
    expect(readFileSync(file, 'utf8')).toBe(formatted);
  });
});
