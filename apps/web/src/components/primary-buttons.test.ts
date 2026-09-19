import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/** Primary actions must use the shared component rather than a second color policy. */
describe('primary action consistency', () => {
  it('routes native primary actions through Button', () => {
    const root = path.resolve('apps/web/src');
    const violations: string[] = [];
    const scan = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) { scan(file); continue; }
        if (!file.endsWith('.tsx') || file.endsWith('.test.tsx')) continue;
        const text = fs.readFileSync(file, 'utf8');
        const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        const visit = (node: ts.Node) => {
          if (ts.isJsxOpeningElement(node) && node.tagName.getText(source) === 'button') {
            const attrs = node.attributes.getText(source);
            if (attrs.includes('ui-button-primary') || /backgroundColor:\s*['"]var\(--color-primary\)['"]/.test(attrs) || attrs.includes('text-on-primary') && attrs.includes('bg-primary') || attrs.includes('mobile-nav-create')) {
              violations.push(`${path.relative(root, file)}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
            }
          }
          ts.forEachChild(node, visit);
        };
        visit(source);
      }
    };
    scan(root);
    expect(violations).toEqual([]);
  });
});
