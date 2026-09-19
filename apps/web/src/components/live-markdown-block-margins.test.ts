import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * CodeMirror measures block heights with getBoundingClientRect, which excludes margins.
 * A vertical margin on an editor block shifts every click below it to the wrong line.
 */
describe('live markdown block margins', () => {
  it('keeps pagination blocks free of vertical margins', () => {
    const css = fs.readFileSync(path.resolve('apps/web/src/workspace.css'), 'utf8');
    const violations: string[] = [];
    for (const match of css.matchAll(/(\.live-md-page-(?:break|divider|footer))\s*\{([^}]*)\}/g)) {
      for (const declaration of match[2].split(';')) {
        if (/^\s*margin(?:-top|-bottom|-block(?:-start|-end)?)?\s*:/.test(declaration)) violations.push(`${match[1]}: ${declaration.trim()}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('contains rendered markdown child margins inside block widgets', () => {
    const source = fs.readFileSync(path.resolve('apps/web/src/components/live-markdown/widgets.ts'), 'utf8');
    expect(source).toMatch(/if\s*\(this\.block\)\s*\{\s*dom\.style\.display\s*=\s*'flow-root';/);
  });
});
